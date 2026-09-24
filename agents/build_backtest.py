#!/usr/bin/env python3
"""Build agent: portfolio backtest engine (source of truth for review).

Rebalancing: same-day mark-to-market THEN rebalance (do not zero rebalance-day returns).
Monthly DCA: on first trading day of each month, add cash then buy to target weights.
Trading cost (mom_cost / trade cost): on each rebalance, value -= value × TO × rate
where TO = 0.5 × Σ|w_new−w_old| (one-way turnover). Default rate 0.1% (0–0.5%).
"""
from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BUNDLE = DATA / "etf_prices.json"
META = DATA / "etf_meta.json"
PRICES_DIR = DATA / "prices"


@dataclass
class Stats:
    start: str
    end: str
    days: int
    years: float
    total_return: float
    cagr: float
    mdd: float
    vol: float
    sharpe: float
    best_year: float | None
    worst_year: float | None
    yearly: dict
    curve: list
    total_invested: float = 1.0
    final_value: float = 1.0
    contributions: int = 0
    mom_holdings: list | None = None
    last_regime: str | None = None
    regime_log: list | None = None
    hedge_active: bool | None = None
    hedge_log: list | None = None
    gold_active: bool | None = None
    gold_holding: str | None = None
    gold_log: list | None = None
    rebal_count: int = 0
    band_applied: bool = False
    band_pct: float | None = None
    trade_cost: float = 0.001
    total_cost_drag: float = 0.0


def load(codes: list[str] | None = None):
    """Load meta + prices. If codes given, load only those (+ files on disk).

    Prefer selective per-ticker files when present; fall back to bundle.
    """
    if META.exists():
        raw = json.loads(META.read_text(encoding="utf-8"))
    elif BUNDLE.exists():
        raw = json.loads(BUNDLE.read_text(encoding="utf-8"))
    else:
        raise FileNotFoundError("data/etf_meta.json 또는 etf_prices.json 이 필요합니다")

    want = None
    if codes:
        want = set(codes) | {raw.get("benchmark", "069500")}

    prices: dict[str, dict[str, float]] = {}
    # Bundle prices if available
    if BUNDLE.exists():
        bundle = json.loads(BUNDLE.read_text(encoding="utf-8"))
        raw.setdefault("etfs", bundle.get("etfs", raw.get("etfs", [])))
        for code, rows in bundle.get("prices", {}).items():
            if want is not None and code not in want:
                continue
            prices[code] = {r["d"]: r["c"] for r in rows}

    # Per-file overrides / fills (selective load).
    # Prefer per-file when it has earlier or longer history than the bundle
    # (e.g. after a --merge extend of older years).
    if PRICES_DIR.exists():
        files = list(PRICES_DIR.glob("*.json"))
        for path in files:
            code = path.stem
            if want is not None and code not in want:
                continue
            rows = json.loads(path.read_text(encoding="utf-8"))
            file_map = {r["d"]: r["c"] for r in rows}
            if code not in prices:
                prices[code] = file_map
                continue
            bundle_dates = sorted(prices[code])
            file_dates = sorted(file_map)
            if not bundle_dates or (
                file_dates
                and (file_dates[0] < bundle_dates[0] or len(file_dates) > len(bundle_dates))
            ):
                prices[code] = file_map

    if "prices" not in raw:
        raw["prices"] = {
            c: [{"d": d, "c": px} for d, px in sorted(m.items())]
            for c, m in prices.items()
        }
    return raw, prices


def _is_rebal(prev, cur, rebalance: str) -> bool:
    if rebalance == "N":
        return False
    if prev is None:
        return True
    py, pm, *_ = prev.split("-")
    cy, cm, *_ = cur.split("-")
    if rebalance == "Y":
        return py != cy
    if rebalance in ("M", "MOM", "DMOM", "MOM12_1", "XSMOM"):
        return prev[:7] != cur[:7]
    q = lambda m: (int(m) - 1) // 3
    return py != cy or q(pm) != q(cm)


def _is_new_month(prev, cur) -> bool:
    if prev is None:
        return False
    return prev[:7] != cur[:7]


def _shift_month(ym: str, delta: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    m += delta
    while m <= 0:
        m += 12
        y -= 1
    while m > 12:
        m -= 12
        y += 1
    return f"{y:04d}-{m:02d}"


def _month_end_closes(price_map: dict[str, float]) -> dict[str, tuple[str, float]]:
    """Map YYYY-MM -> (last_trading_day, close) for one ticker."""
    by_m: dict[str, str] = {}
    for d in price_map:
        ym = d[:7]
        if ym not in by_m or d > by_m[ym]:
            by_m[ym] = d
    return {ym: (d, price_map[d]) for ym, d in by_m.items()}


def _momentum_pick(
    universe: list[str],
    prices: dict,
    signal_month: str,
    lookback: int,
    top_n: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
) -> tuple[list[str], dict[str, float]]:
    """Pick top-N by prior lookback return ending at prior month-end (no look-ahead)."""
    end_ym = _shift_month(signal_month, -1)
    start_ym = _shift_month(end_ym, -lookback)
    scored: list[tuple[float, str]] = []
    for c in universe:
        ends = month_ends_cache.get(c) or {}
        if end_ym not in ends or start_ym not in ends:
            continue
        _ed, end_px = ends[end_ym]
        _sd, start_px = ends[start_ym]
        if start_px <= 0 or end_px <= 0:
            continue
        # Sanity: end date must be strictly before signal month (no look-ahead)
        if _ed[:7] >= signal_month:
            continue
        scored.append((end_px / start_px - 1.0, c))
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked = [c for _r, c in scored[: max(1, top_n)]]
    if not picked:
        # Fallback: equal-weight whole universe that has a price history
        picked = list(universe)
    n = len(picked)
    tw = {c: 1.0 / n for c in picked}
    return picked, tw


def _lookback_return(
    code: str,
    signal_month: str,
    lookback: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
) -> float | None:
    end_ym = _shift_month(signal_month, -1)
    start_ym = _shift_month(end_ym, -lookback)
    ends = month_ends_cache.get(code) or {}
    if end_ym not in ends or start_ym not in ends:
        return None
    _ed, end_px = ends[end_ym]
    _sd, start_px = ends[start_ym]
    if start_px <= 0 or end_px <= 0:
        return None
    if _ed[:7] >= signal_month:
        return None
    return end_px / start_px - 1.0


def _dual_momentum_pick(
    universe: list[str],
    prices: dict,
    signal_month: str,
    lookback: int,
    top_n: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
    cash_code: str,
) -> tuple[list[str], dict[str, float]]:
    """Relative MOM top-N, then per-name absolute filter vs cash (swap losers to cash)."""
    end_ym = _shift_month(signal_month, -1)
    start_ym = _shift_month(end_ym, -lookback)
    scored: list[tuple[float, str]] = []
    for c in universe:
        ends = month_ends_cache.get(c) or {}
        if end_ym not in ends or start_ym not in ends:
            continue
        _ed, end_px = ends[end_ym]
        _sd, start_px = ends[start_ym]
        if start_px <= 0 or end_px <= 0:
            continue
        if _ed[:7] >= signal_month:
            continue
        scored.append((end_px / start_px - 1.0, c))
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked_scored = scored[: max(1, top_n)]
    if not picked_scored:
        return [cash_code], {cash_code: 1.0}

    cash_ret = _lookback_return(cash_code, signal_month, lookback, month_ends_cache)
    slots: list[str] = []
    for ret, c in picked_scored:
        if cash_ret is not None and ret <= cash_ret:
            slots.append(cash_code)
        else:
            slots.append(c)
    n = len(slots)
    tw: dict[str, float] = {}
    for c in slots:
        tw[c] = tw.get(c, 0.0) + 1.0 / n
    return list(tw.keys()), tw



def _momentum_pick_12_1(
    universe: list[str],
    prices: dict,
    signal_month: str,
    top_n: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
) -> tuple[list[str], dict[str, float]]:
    """12-1 skip-month MOM: 12m return ending at prior-prior month-end (skip most recent 1m)."""
    end_ym = _shift_month(signal_month, -2)  # skip most recent completed month
    start_ym = _shift_month(end_ym, -12)
    scored: list[tuple[float, str]] = []
    for c in universe:
        ends = month_ends_cache.get(c) or {}
        if end_ym not in ends or start_ym not in ends:
            continue
        _ed, end_px = ends[end_ym]
        _sd, start_px = ends[start_ym]
        if start_px <= 0 or end_px <= 0:
            continue
        if _ed[:7] >= signal_month:
            continue
        scored.append((end_px / start_px - 1.0, c))
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked = [c for _r, c in scored[: max(1, top_n)]]
    if not picked:
        picked = list(universe)
    n = len(picked)
    tw = {c: 1.0 / n for c in picked}
    return picked, tw


def _xs_momentum_pick(
    universe: list[str],
    prices: dict,
    signal_month: str,
    lookback: int,
    top_n: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
) -> tuple[list[str], dict[str, float]]:
    """Cross-sectional residual MOM: lookback ret − EW universe mean; top N. Guard universe < 5."""
    if len(universe) < 5:
        raise ValueError("XS 모멘텀은 유니버스 5종 이상이 필요합니다.")
    end_ym = _shift_month(signal_month, -1)
    start_ym = _shift_month(end_ym, -lookback)
    scored_raw: list[tuple[float, str]] = []
    for c in universe:
        ends = month_ends_cache.get(c) or {}
        if end_ym not in ends or start_ym not in ends:
            continue
        _ed, end_px = ends[end_ym]
        _sd, start_px = ends[start_ym]
        if start_px <= 0 or end_px <= 0:
            continue
        if _ed[:7] >= signal_month:
            continue
        scored_raw.append((end_px / start_px - 1.0, c))
    if not scored_raw:
        n = len(universe)
        return list(universe), {c: 1.0 / n for c in universe}
    mean_ret = sum(r for r, _c in scored_raw) / len(scored_raw)
    scored = [(r - mean_ret, c) for r, c in scored_raw]
    scored.sort(key=lambda x: (-x[0], x[1]))
    picked = [c for _r, c in scored[: max(1, top_n)]]
    n = len(picked)
    tw = {c: 1.0 / n for c in picked}
    return picked, tw


def _load_etf_flags() -> dict[str, dict]:
    if not META.exists():
        return {}
    meta = json.loads(META.read_text(encoding="utf-8"))
    out = {}
    for e in meta.get("etfs") or []:
        code = e.get("code")
        if not code:
            continue
        out[str(code)] = {
            "category": e.get("category") or "기타",
            "leveraged": bool(e.get("leveraged")),
        }
    return out


def _portfolio_trailing_vol_ann(
    tw: dict[str, float],
    prices: dict,
    asof: str,
    window: int = 60,
) -> float | None:
    """Annualized realized vol of fixed-weight sleeve from daily simple returns ending before asof."""
    codes = [c for c, w in tw.items() if w > 0 and c in prices]
    if not codes:
        return None
    total = sum(tw[c] for c in codes)
    if total <= 0:
        return None
    norm = {c: tw[c] / total for c in codes}
    date_sets = [set(d for d in prices[c] if d < asof) for c in codes]
    common = sorted(set.intersection(*date_sets)) if date_sets else []
    if len(common) < window + 1:
        return None
    use = common[-(window + 1) :]
    rets: list[float] = []
    for a, b in zip(use, use[1:]):
        r = 0.0
        ok = True
        for c in codes:
            pa, pb = prices[c][a], prices[c][b]
            if pa <= 0 or pb <= 0:
                ok = False
                break
            r += norm[c] * (pb / pa - 1.0)
        if not ok:
            return None
        rets.append(r)
    if len(rets) < 2:
        return None
    sig = statistics.stdev(rets)
    if sig < 1e-15:
        return None
    return sig * (252 ** 0.5)


def _apply_vol_target(
    tw: dict[str, float],
    prices: dict,
    asof: str,
    target_vol: float,
    window: int,
    cash_code: str,
    etf_flags: dict[str, dict] | None = None,
) -> dict[str, float]:
    """Scale risky sleeve so trailing vol ≈ target; residual → cash. Cap scale ≤ 1. Drop leveraged."""
    flags = etf_flags or {}
    cash_w = float(tw.get(cash_code, 0.0))
    risky: dict[str, float] = {}
    dropped = 0.0
    for c, w in tw.items():
        if w <= 0:
            continue
        if c == cash_code:
            continue
        if flags.get(c, {}).get("leveraged"):
            dropped += w
            continue
        risky[c] = w
    # Dropped leveraged weight goes to cash
    cash_w += dropped
    if not risky:
        return {cash_code: 1.0}
    rsum = sum(risky.values())
    # Renormalize risky to its current sleeve mass for vol estimate
    risky_unit = {c: w / rsum for c, w in risky.items()}
    port_vol = _portfolio_trailing_vol_ann(risky_unit, prices, asof, window)
    if port_vol is None or port_vol <= 0:
        scale = 1.0
    else:
        scale = min(1.0, float(target_vol) / port_vol)
    out: dict[str, float] = {c: risky[c] * scale for c in risky}
    used = sum(out.values())
    out[cash_code] = max(0.0, 1.0 - used)
    # Numerical clean
    s = sum(out.values())
    if s > 0:
        out = {c: w / s for c, w in out.items() if w > 1e-15}
    return out


def _apply_sleeve_trend(
    tw: dict[str, float],
    signal_month: str,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
    prices: dict,
    asof: str,
    cash_code: str,
    mode: str,
    lookback: int,
    ma_window: int,
    etf_flags: dict[str, dict] | None = None,
) -> dict[str, float]:
    """Per-category absolute momentum or MA ON/OFF; OFF sleeve → cash. Missing signal → OFF."""
    flags = etf_flags or {}
    # Group non-cash weights by category
    sleeves: dict[str, dict[str, float]] = {}
    cash_w = float(tw.get(cash_code, 0.0))
    for c, w in tw.items():
        if w <= 0:
            continue
        if c == cash_code:
            continue
        cat = flags.get(c, {}).get("category") or "기타"
        sleeves.setdefault(cat, {})[c] = w

    out: dict[str, float] = {}
    for cat, members in sleeves.items():
        if cat == "현금성":
            for c, w in members.items():
                out[c] = out.get(c, 0.0) + w
            continue
        on = False
        if mode == "ma":
            # Largest-weight member vs SMA (asof-prior closes only)
            proxy = max(members.items(), key=lambda x: (x[1], x[0]))[0]
            pm = prices.get(proxy) or {}
            on = _ma_risk_on(pm, asof, ma_window) if pm else False
        else:
            # Absolute momentum: EW lookback return of sleeve > 0; any missing → OFF
            rets = []
            for c in members:
                r = _lookback_return(c, signal_month, lookback, month_ends_cache)
                if r is None:
                    rets = []
                    break
                rets.append(r)
            if rets:
                on = (sum(rets) / len(rets)) > 0.0
            else:
                on = False
        if on:
            for c, w in members.items():
                out[c] = out.get(c, 0.0) + w
        else:
            cash_w += sum(members.values())
    out[cash_code] = out.get(cash_code, 0.0) + cash_w
    s = sum(out.values())
    if s <= 0:
        return {cash_code: 1.0}
    return {c: w / s for c, w in out.items() if w > 1e-15}


def _trailing_vol(price_map: dict[str, float], asof: str, window: int = 60) -> float | None:
    """Realized vol from daily log returns over `window` days ending before asof (no look-ahead)."""
    dates = sorted(d for d in price_map if d < asof)
    if len(dates) < window + 1:
        return None
    use = dates[-(window + 1) :]
    logs: list[float] = []
    for a, b in zip(use, use[1:]):
        pa, pb = price_map[a], price_map[b]
        if pa <= 0 or pb <= 0:
            return None
        logs.append(math.log(pb / pa))
    if len(logs) < 2:
        return None
    sig = statistics.stdev(logs)
    if sig < 1e-15:
        return None
    return sig


def _inv_vol_weights(
    codes: list[str],
    prices: dict,
    asof: str,
    window: int = 60,
    fallback_tw: dict[str, float] | None = None,
) -> dict[str, float]:
    """Weight ∝ 1/σ; skip σ≈0 / short history; fallback equal among remaining or fallback_tw."""
    vols: dict[str, float] = {}
    for c in codes:
        if c not in prices:
            continue
        v = _trailing_vol(prices[c], asof, window)
        if v is not None:
            vols[c] = v
    if not vols:
        if fallback_tw:
            return {c: fallback_tw[c] for c in codes if c in fallback_tw} or dict(fallback_tw)
        n = len(codes)
        return {c: 1.0 / n for c in codes} if n else {}
    inv = {c: 1.0 / v for c, v in vols.items()}
    s = sum(inv.values())
    return {c: inv[c] / s for c in inv}


def _ma_risk_on(bench_prices: dict[str, float], asof: str, window: int = 200) -> bool:
    """Risk-on if prior close >= SMA(window) using closes strictly before asof."""
    dates = sorted(d for d in bench_prices if d < asof)
    if len(dates) < window:
        return True  # insufficient history → leave strategy weights unchanged
    window_dates = dates[-window:]
    sma = sum(bench_prices[d] for d in window_dates) / window
    prior = bench_prices[dates[-1]]
    return prior >= sma


def _apply_ma_overlay(
    tw: dict[str, float],
    risk_on: bool,
    cash_code: str,
    ma_cash_pct: float,
) -> dict[str, float]:
    if risk_on:
        return dict(tw)
    cash_pct = min(1.0, max(0.0, float(ma_cash_pct)))
    scale = 1.0 - cash_pct
    out: dict[str, float] = {}
    for c, w in tw.items():
        if c == cash_code:
            continue
        nw = w * scale
        if nw > 0:
            out[c] = nw
    out[cash_code] = out.get(cash_code, 0.0) + cash_pct
    s = sum(out.values())
    if s <= 0:
        return {cash_code: 1.0}
    return {c: w / s for c, w in out.items()}


# --- 국면 헤지(실험): see docs/EXPERIMENT_REGIME_HEDGE.md ---
# Dual-MA signal (069500 ∧ 133690 below SMA) → optional −1x 114800 or cash sleeve ≤15%.
# NOT a default strategy. 2X inverse forbidden. No look-ahead (SMA uses dates < asof).
BENCH_CODE = "069500"
REGIME_HEDGE_SIGNAL_A = "069500"
REGIME_HEDGE_SIGNAL_B = "133690"
REGIME_HEDGE_INV_CODE = "114800"  # −1x only
REGIME_HEDGE_FORBIDDEN_2X = frozenset({"252670"})  # KODEX 200선물인버스2X 등
REGIME_HEDGE_MAX_PCT = 0.15


def _regime_hedge_signal(
    prices: dict,
    asof: str,
    window: int = 200,
    code_a: str = REGIME_HEDGE_SIGNAL_A,
    code_b: str = REGIME_HEDGE_SIGNAL_B,
) -> bool:
    """True when BOTH signal ETFs are below their SMA (MA↓ ∧ MA↓). No look-ahead."""
    if code_a not in prices or code_b not in prices:
        return False
    a_on = _ma_risk_on(prices[code_a], asof, window)  # True = price >= SMA
    b_on = _ma_risk_on(prices[code_b], asof, window)
    return (not a_on) and (not b_on)


def _apply_regime_hedge(
    tw: dict[str, float],
    hedge_on: bool,
    hedge_code: str,
    hedge_pct: float,
) -> dict[str, float]:
    """Scale risk sleeve; allocate capped hedge weight when hedge_on."""
    if not hedge_on:
        return dict(tw)
    pct = min(REGIME_HEDGE_MAX_PCT, max(0.0, float(hedge_pct)))
    if pct <= 0:
        return dict(tw)
    scale = 1.0 - pct
    out: dict[str, float] = {}
    for c, w in tw.items():
        if c == hedge_code:
            continue
        nw = w * scale
        if nw > 0:
            out[c] = nw
    out[hedge_code] = out.get(hedge_code, 0.0) + pct
    s = sum(out.values())
    if s <= 0:
        return {hedge_code: 1.0}
    return {c: w / s for c, w in out.items()}


def _resolve_regime_hedge_code(mode: str, cash_code: str, hedge_code: str | None) -> str:
    mode = (mode or "inverse").lower()
    if mode == "cash":
        return cash_code or "153130"
    code = hedge_code or REGIME_HEDGE_INV_CODE
    if code in REGIME_HEDGE_FORBIDDEN_2X:
        raise ValueError(f"2X 인버스 {code} 는 국면 헤지(실험)에서 금지입니다 (−1x {REGIME_HEDGE_INV_CODE}만 허용)")
    if code != REGIME_HEDGE_INV_CODE:
        raise ValueError(f"인버스 헤지는 {REGIME_HEDGE_INV_CODE} (−1x)만 허용 (요청={code})")
    return code



# --- GOLDON (금 온/오프 슬리브): absolute momentum overlay, not a rebalance mode ---
# Signal gold_code vs cash proxy 153130 (fixed). Carve sleevePct; renormalize rest.
# Default gold_code=411060 (spot). Long-history proxy: 132030 KODEX 골드선물(H).
# Overlay order: base → invVol → maOverlay → regime hedge → gold sleeve last (G1).
GOLD_CODE = "411060"
GOLD_CODE_FUTURES = "132030"  # long KRX gold futures (H); not a silent default swap
GOLD_CASH = "153130"  # NEVER 0072R0 in this signature
GOLD_COST = 0.001
GOLD_SLEEVE_DEFAULT = 0.15
GOLD_SLEEVE_MIN = 0.10
GOLD_SLEEVE_MAX = 0.20
GOLD_CODES_ALLOWED = ("411060", "132030", "139320", "319640")


def _clamp_gold_sleeve(sleeve_pct: float) -> float:
    v = float(sleeve_pct) if sleeve_pct is not None else GOLD_SLEEVE_DEFAULT
    return min(GOLD_SLEEVE_MAX, max(GOLD_SLEEVE_MIN, v))


def _resolve_gold_code(gold_code: str | None) -> str:
    if gold_code is None or str(gold_code).strip() == "":
        return GOLD_CODE
    code = str(gold_code).strip().zfill(6)
    return code


def _gold_signal_on(
    signal_month: str,
    lookback: int,
    month_ends_cache: dict[str, dict[str, tuple[str, float]]],
    gold_code: str = GOLD_CODE,
) -> bool:
    """ON iff gold lookback ret > cash lookback ret (prior month-end window). Missing → OFF."""
    gold_ret = _lookback_return(gold_code, signal_month, lookback, month_ends_cache)
    cash_ret = _lookback_return(GOLD_CASH, signal_month, lookback, month_ends_cache)
    if gold_ret is None or cash_ret is None:
        return False
    return gold_ret > cash_ret


def _apply_gold_sleeve(
    tw: dict[str, float],
    gold_on: bool,
    sleeve_pct: float,
    gold_code: str = GOLD_CODE,
) -> dict[str, float]:
    """ON → sleeve in gold_code; OFF → sleeve in 153130. Strip gold_code from rest (G1)."""
    sleeve = _clamp_gold_sleeve(sleeve_pct)
    rest_scale = 1.0 - sleeve
    rest: dict[str, float] = {}
    for c, w in tw.items():
        if c == gold_code:
            continue
        if w > 0:
            rest[c] = rest.get(c, 0.0) + w
    s = sum(rest.values())
    out: dict[str, float] = {}
    if s > 0:
        for c, w in rest.items():
            out[c] = (w / s) * rest_scale
    else:
        # empty rest after strip → park remainder in cash proxy
        out[GOLD_CASH] = rest_scale
    hold = gold_code if gold_on else GOLD_CASH
    out[hold] = out.get(hold, 0.0) + sleeve
    tot = sum(out.values())
    if tot <= 0:
        return {GOLD_CASH: 1.0}
    return {c: w / tot for c, w in out.items() if w > 0}



BAND_PCT_DEFAULT = 0.05
BAND_PCT_MIN = 0.01
BAND_PCT_MAX = 0.10


def _clamp_band_pct(band_pct: float | None) -> float:
    """Band half-width as fraction of portfolio (UI 1–10%, default 5%)."""
    v = float(band_pct) if band_pct is not None else BAND_PCT_DEFAULT
    if not math.isfinite(v):
        v = BAND_PCT_DEFAULT
    return min(BAND_PCT_MAX, max(BAND_PCT_MIN, v))


def _band_drift_exceeds(
    units: dict[str, float],
    prices: dict,
    d: str,
    value: float,
    target_tw: dict[str, float],
    band_pct: float,
) -> bool:
    """True if any holding |current_w - target_w| > band (after MTM)."""
    if value <= 0 or band_pct < 0:
        return False
    codes = set(units.keys()) | set(target_tw.keys())
    for c in codes:
        if c in units:
            px = prices.get(c, {}).get(d)
            if px is None or px <= 0:
                continue
            w = units[c] * px / value
        else:
            w = 0.0
        t = float(target_tw.get(c, 0.0))
        if abs(w - t) > band_pct + 1e-12:
            return True
    return False



TRADE_COST_DEFAULT = 0.001  # 0.1% = 10bps (matches legacy MOM switch cost)
TRADE_COST_MIN = 0.0
TRADE_COST_MAX = 0.005  # 0.5% = 50bps


def _clamp_trade_cost(rate: float | None) -> float:
    """Trading cost rate as fraction of one-way traded notional (0–0.5%)."""
    if rate is None:
        v = TRADE_COST_DEFAULT
    else:
        try:
            v = float(rate)
        except (TypeError, ValueError):
            v = TRADE_COST_DEFAULT
    if not math.isfinite(v):
        v = TRADE_COST_DEFAULT
    return min(TRADE_COST_MAX, max(TRADE_COST_MIN, v))


def _current_weights(units: dict, prices: dict, d: str, value: float) -> dict[str, float]:
    if not (value > 0) or not units:
        return {}
    out: dict[str, float] = {}
    for c, u in units.items():
        px = prices.get(c, {}).get(d)
        if px is None or not (px > 0):
            continue
        out[c] = (u * px) / value
    return out


def _one_way_turnover(w_old: dict[str, float], w_new: dict[str, float]) -> float:
    """One-way turnover = 0.5 * sum_i |w_new_i - w_old_i| (fraction of portfolio)."""
    codes = set(w_old or {}) | set(w_new or {})
    s = 0.0
    for c in codes:
        s += abs(float((w_new or {}).get(c, 0.0)) - float((w_old or {}).get(c, 0.0)))
    return 0.5 * s


def backtest(
    weights: dict[str, float],
    prices: dict,
    start="2018-01-01",
    end="2099-12-31",
    rebalance="Q",
    initial_capital: float = 1.0,
    monthly_contribution: float = 0.0,
    mom_lookback: int = 1,
    mom_top_n: int = 3,
    mom_cost: float = 0.001,
    weighting: str = "fixed",
    vol_window: int = 60,
    ma_overlay: bool = False,
    ma_window: int = 200,
    cash_code: str = "153130",
    ma_cash_pct: float = 1.0,
    regime_hedge: bool = False,
    regime_hedge_mode: str = "inverse",
    regime_hedge_pct: float = 0.15,
    regime_hedge_code: str | None = None,
    gold_on: bool = False,
    gold_sleeve_pct: float = GOLD_SLEEVE_DEFAULT,
    gold_lookback: int = 1,
    gold_code: str | None = None,
    band_on: bool = False,
    band_pct: float = BAND_PCT_DEFAULT,
    vol_target: bool = False,
    vol_target_pct: float = 0.10,
    vol_target_window: int = 60,
    sleeve_trend: bool = False,
    sleeve_trend_mode: str = "abs",
    sleeve_trend_lookback: int = 1,
    etf_flags: dict[str, dict] | None = None,
):
    codes = [c for c, w in weights.items() if w > 0]
    if not codes:
        raise ValueError("empty")
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive")
    if rebalance in ("MOM", "DMOM", "MOM12_1", "XSMOM") and not codes:
        raise ValueError("모멘텀 유니버스가 비어 있습니다. ETF를 선택하세요.")
    if rebalance == "XSMOM" and len(codes) < 5:
        raise ValueError("XS 모멘텀은 유니버스 5종 이상이 필요합니다.")

    need_cash = (
        rebalance == "DMOM"
        or ma_overlay
        or bool(vol_target)
        or bool(sleeve_trend)
        or (regime_hedge and regime_hedge_mode == "cash")
    )
    if need_cash:
        if cash_code not in prices:
            raise ValueError(f"안전자산 {cash_code} 시세가 없습니다")
    gold_hold = _resolve_gold_code(gold_code)
    if gold_on:
        if gold_hold not in prices:
            raise ValueError(f"금 슬리브 신호용 {gold_hold} 시세가 없습니다")
        if GOLD_CASH not in prices:
            raise ValueError(f"금 슬리브 현금대리 {GOLD_CASH} 시세가 없습니다")
    if ma_overlay and BENCH_CODE not in prices:
        raise ValueError(f"벤치마크 {BENCH_CODE} 시세가 없습니다")

    hedge_code_res = None
    if regime_hedge:
        hedge_code_res = _resolve_regime_hedge_code(
            regime_hedge_mode, cash_code, regime_hedge_code
        )
        for sig in (REGIME_HEDGE_SIGNAL_A, REGIME_HEDGE_SIGNAL_B):
            if sig not in prices:
                raise ValueError(f"국면 헤지 신호용 {sig} 시세가 없습니다")
        if hedge_code_res not in prices:
            raise ValueError(f"국면 헤지 자산 {hedge_code_res} 시세가 없습니다")

    total_w = sum(weights[c] for c in codes)
    tw = {c: weights[c] / total_w for c in codes}

    calendar_codes = list(codes)
    if need_cash and cash_code not in calendar_codes:
        calendar_codes.append(cash_code)
    if regime_hedge:
        for extra in (REGIME_HEDGE_SIGNAL_A, REGIME_HEDGE_SIGNAL_B, hedge_code_res):
            if extra and extra not in calendar_codes:
                calendar_codes.append(extra)
    if gold_on:
        for extra in (gold_hold, GOLD_CASH):
            if extra not in calendar_codes:
                calendar_codes.append(extra)

    calendars = []
    for c in calendar_codes:
        ds = sorted(d for d in prices[c] if start <= d <= end)
        if len(ds) < 20:
            raise ValueError(f"{c} 데이터 부족")
        calendars.append(set(ds))
    common = sorted(set.intersection(*calendars))
    if len(common) < 20:
        raise ValueError("공통 기간이 너무 짧습니다")

    lookback = 3 if int(mom_lookback) >= 3 else 1
    top_n = max(1, int(mom_top_n))
    cost = _clamp_trade_cost(mom_cost)
    vol_win = max(2, int(vol_window))
    ma_win = max(2, int(ma_window))
    use_inv = weighting == "invVol"
    mom_like = rebalance in ("MOM", "DMOM", "MOM12_1", "XSMOM")
    gold_lb = 3 if int(gold_lookback) >= 3 else 1
    gold_sleeve = _clamp_gold_sleeve(gold_sleeve_pct)
    # Band applies to fixed-target modes only; MOM/DMOM keep calendar monthly swaps.
    band_active = bool(band_on) and not mom_like
    band_pct_c = _clamp_band_pct(band_pct) if band_active else 0.0

    month_ends_codes = list(codes)
    if rebalance == "DMOM" and cash_code not in month_ends_codes:
        month_ends_codes.append(cash_code)
    if gold_on:
        for extra in (gold_hold, GOLD_CASH):
            if extra not in month_ends_codes:
                month_ends_codes.append(extra)
    flags = etf_flags if etf_flags is not None else _load_etf_flags()
    vt_on = bool(vol_target)
    vt_pct = max(0.01, min(0.5, float(vol_target_pct)))
    vt_win = max(5, int(vol_target_window) or 60)
    st_on = bool(sleeve_trend)
    st_mode = "ma" if sleeve_trend_mode == "ma" else "abs"
    st_lb = 3 if int(sleeve_trend_lookback) >= 3 else 1

    month_ends_cache = (
        {c: _month_end_closes(prices[c]) for c in month_ends_codes}
        if (mom_like or gold_on or st_on)
        else {}
    )
    if st_on:
        for c in list(codes) + ([cash_code] if cash_code not in month_ends_codes else []):
            if c not in month_ends_cache and c in prices:
                month_ends_cache[c] = _month_end_closes(prices[c])

    units = None
    value = float(initial_capital)
    peak = value
    mdd = 0.0
    curve = []
    rets = []
    prev = None
    prev_value = None
    total_invested = float(initial_capital)
    contributions = 1
    active_codes = list(codes)
    prev_holdings: set[str] | None = None
    mom_holdings: list[dict] = []
    current_tw = dict(tw)
    last_regime: str | None = None
    regime_log: list[dict] = []
    last_hedge: bool | None = None
    hedge_log: list[dict] = []
    last_gold_on: bool | None = None
    last_gold_holding: str | None = None
    gold_log: list[dict] = []
    prev_gold_state: bool | None = None
    rebal_count = 0
    total_cost_drag = 0.0

    def _target_weights(d: str) -> tuple[dict[str, float], list[str], bool | None]:
        nonlocal last_regime, last_hedge, last_gold_on, last_gold_holding
        if rebalance == "MOM":
            _picked, base = _momentum_pick(
                codes, prices, d[:7], lookback, top_n, month_ends_cache
            )
        elif rebalance == "MOM12_1":
            _picked, base = _momentum_pick_12_1(
                codes, prices, d[:7], top_n, month_ends_cache
            )
        elif rebalance == "XSMOM":
            _picked, base = _xs_momentum_pick(
                codes, prices, d[:7], lookback, top_n, month_ends_cache
            )
        elif rebalance == "DMOM":
            _picked, base = _dual_momentum_pick(
                codes, prices, d[:7], lookback, top_n, month_ends_cache, cash_code
            )
        else:
            base = dict(tw)
            _picked = list(codes)

        if use_inv:
            base = _inv_vol_weights(list(base.keys()), prices, d, vol_win, fallback_tw=base)

        if ma_overlay:
            risk_on = _ma_risk_on(prices[BENCH_CODE], d, ma_win)
            last_regime = "on" if risk_on else "off"
            regime_log.append({"date": d, "regime": last_regime})
            base = _apply_ma_overlay(base, risk_on, cash_code, ma_cash_pct)
        elif last_regime is None:
            last_regime = None

        if regime_hedge and hedge_code_res:
            hedge_on = _regime_hedge_signal(prices, d, ma_win)
            last_hedge = hedge_on
            hedge_log.append({"date": d, "hedge": hedge_on})
            pct = min(REGIME_HEDGE_MAX_PCT, max(0.0, float(regime_hedge_pct)))
            base = _apply_regime_hedge(base, hedge_on, hedge_code_res, pct)

        if st_on:
            base = _apply_sleeve_trend(
                base, d[:7], month_ends_cache, prices, d, cash_code,
                st_mode, st_lb, ma_win, flags,
            )

        if vt_on:
            base = _apply_vol_target(
                base, prices, d, vt_pct, vt_win, cash_code, flags,
            )

        # GOLDON last so gold_hold weight stays exactly 0 or sleevePct (G1)
        gold_state = None
        if gold_on:
            gold_state = _gold_signal_on(d[:7], gold_lb, month_ends_cache, gold_hold)
            base = _apply_gold_sleeve(base, gold_state, gold_sleeve, gold_hold)
            last_gold_on = gold_state
            last_gold_holding = gold_hold if gold_state else GOLD_CASH
            gold_log.append({
                "date": d,
                "month": d[:7],
                "on": gold_state,
                "holding": last_gold_holding,
                "weights": dict(base),
            })

        active = [c for c, w in base.items() if w > 0]
        return base, active, gold_state

    for d in common:
        if units is None:
            # Day 0
            current_tw, active_codes, g_state = _target_weights(d)
            units = {c: (current_tw[c] * value) / prices[c][d] for c in active_codes}
            prev_holdings = set(active_codes)
            if gold_on:
                prev_gold_state = g_state
            if mom_like:
                mom_holdings.append({
                    "month": d[:7],
                    "codes": list(active_codes),
                    "weights": dict(current_tw),
                })
            value = sum(units[c] * prices[c][d] for c in active_codes)
        else:
            # 1) Mark to market
            value = sum(units[c] * prices[c][d] for c in active_codes)
            if prev_value is not None and prev_value > 0:
                rets.append((d, value / prev_value - 1.0))

            # 2) Monthly DCA cash inflow on first trading day of new month
            # Band mode: ignore Q/Y/M calendar; check drift daily vs last targets.
            # MOM/DMOM: band_active is False → keep monthly calendar.
            if band_active:
                do_rebal = False
            else:
                do_rebal = _is_rebal(prev, d, rebalance)
            # 국면 헤지(실험): 헤지 슬리브는 월 1회만 갱신
            if regime_hedge and _is_new_month(prev, d):
                do_rebal = True
            # GOLDON: month-start timing same as MOM
            if gold_on and _is_new_month(prev, d):
                do_rebal = True
            if (vt_on or st_on) and _is_new_month(prev, d):
                do_rebal = True
            if monthly_contribution > 0 and _is_new_month(prev, d):
                value += monthly_contribution
                total_invested += monthly_contribution
                contributions += 1
                do_rebal = True  # deploy cash to target weights
            # Band drift (after MTM / optional DCA cash): any |w-target| > band
            if band_active and _band_drift_exceeds(
                units, prices, d, value, current_tw, band_pct_c
            ):
                do_rebal = True

            # 3) Rebalance after MTM (+ optional cash)
            if do_rebal:
                rebal_count += 1
                # Pre-trade weights after MTM (+ optional DCA cash)
                w_old = _current_weights(units, prices, d, value)
                new_tw, new_active, g_state = _target_weights(d)
                new_set = set(new_active)
                # Unified turnover cost (calendar / band / MOM / gold flip via weight change):
                # drag = value × one_way_turnover × cost_rate
                # one_way_turnover = 0.5 × Σ|w_new − w_old|
                if cost > 0 and prev_holdings is not None:
                    turnover = _one_way_turnover(w_old, new_tw)
                    if turnover > 0:
                        drag = value * turnover * cost
                        total_cost_drag += drag
                        value -= drag
                if gold_on:
                    prev_gold_state = g_state
                current_tw = new_tw
                active_codes = new_active
                units = {c: (current_tw[c] * value) / prices[c][d] for c in active_codes}
                prev_holdings = new_set
                if mom_like:
                    mom_holdings.append({
                        "month": d[:7],
                        "codes": list(active_codes),
                        "weights": dict(current_tw),
                    })
                value = sum(units[c] * prices[c][d] for c in active_codes)

        peak = max(peak, value)
        mdd = min(mdd, value / peak - 1.0)
        # (date, wealth, invested_to_date) — invested grows with DCA cash-ins
        curve.append((d, value, total_invested))
        prev = d
        prev_value = value

    # Wealth index for yearly / total when comparing paths: use value / initial
    # Money metrics use total_invested.
    start_v, end_v = curve[0][1], curve[-1][1]
    days = len(curve) - 1
    years = days / 252.0
    # Simple money-weighted style return vs capital contributed.
    total = end_v / total_invested - 1.0
    cagr = (end_v / total_invested) ** (1 / years) - 1 if years > 0 else 0.0

    # Calendar yearly returns:
    # lump: last_of_year / (first backtest point | prior year-end) - 1
    # DCA: compound daily MTM rets within each calendar year (TWR, pre-cashflow)
    yearly = {}
    if monthly_contribution > 0:
        by_year_rets: dict[str, list[float]] = {}
        for d, r in rets:
            by_year_rets.setdefault(d[:4], []).append(r)
        for y, rs in by_year_rets.items():
            acc = 1.0
            for r in rs:
                acc *= 1.0 + r
            yearly[y] = acc - 1.0
        # Ensure years that appear on the curve (e.g. single day) still exist
        for d, _v, _inv in curve:
            yearly.setdefault(d[:4], 0.0)
    else:
        last_by_year: dict[str, float] = {}
        for d, v, _inv in curve:
            last_by_year[d[:4]] = v
        years_sorted = sorted(last_by_year.keys())
        first_point = curve[0][1]
        prev_end = None
        for y in years_sorted:
            last = last_by_year[y]
            base = first_point if prev_end is None else prev_end
            yearly[y] = last / base - 1.0
            prev_end = last

    ret_vals = [r for _d, r in rets]
    vol = statistics.stdev(ret_vals) * (252 ** 0.5) if len(ret_vals) > 2 else 0.0
    rf = 0.03 / 252
    excess = [r - rf for r in ret_vals]
    mean_ex = sum(excess) / len(excess) if excess else 0
    std = statistics.stdev(ret_vals) if len(ret_vals) > 2 else 0
    sharpe = (mean_ex / std) * (252 ** 0.5) if std else 0.0
    ys = list(yearly.values())
    # Curve: (date, wealth÷initial, cum_return vs invested_to_date).
    # v for MDD/rolling; ret ends at total_return (matches KPI 누적 수익률).
    curve_idx = [
        (d, v / initial_capital, (v / inv - 1.0) if inv > 0 else 0.0)
        for d, v, inv in curve
    ]
    return Stats(
        start=curve[0][0],
        end=curve[-1][0],
        days=days,
        years=years,
        total_return=total,
        cagr=cagr,
        mdd=mdd,
        vol=vol,
        sharpe=sharpe,
        best_year=max(ys) if ys else None,
        worst_year=min(ys) if ys else None,
        yearly=yearly,
        curve=curve_idx,
        total_invested=total_invested,
        final_value=end_v,
        contributions=contributions,
        mom_holdings=mom_holdings if mom_like else None,
        last_regime=last_regime if ma_overlay else None,
        regime_log=regime_log if ma_overlay else None,
        hedge_active=last_hedge if regime_hedge else None,
        hedge_log=hedge_log if regime_hedge else None,
        gold_active=last_gold_on if gold_on else None,
        gold_holding=last_gold_holding if gold_on else None,
        gold_log=gold_log if gold_on else None,
        rebal_count=rebal_count,
        band_applied=band_active,
        band_pct=band_pct_c if band_active else None,
        trade_cost=cost,
        total_cost_drag=total_cost_drag,
    )




def _curve_pairs(curve):
    """Normalize curve to list of (date, value) tuples."""
    out = []
    for point in curve:
        if isinstance(point, dict):
            out.append((point["d"], float(point["v"])))
        else:
            out.append((point[0], float(point[1])))
    return out



def curve_cum_return(point) -> float:
    """Cumulative return vs invested-to-date from a curve point (dict or tuple)."""
    if isinstance(point, dict):
        if "ret" in point:
            return float(point["ret"])
        raise KeyError("curve point missing ret")
    if len(point) < 3:
        raise ValueError("curve point missing cum_return (3rd field)")
    return float(point[2])


def compute_drawdown(curve, episode_threshold: float = -0.05):
    """Underwater drawdown series and episode stats from a wealth curve.

    dd[t] = (v - peak) / peak <= 0. maxDD matches engine mdd for the same path.
    recoveryDate is the first date after trough where value recovers to the
    peak that produced maxDD; None if never recovered.
    Episodes: contiguous underwater stretches with depth <= episode_threshold.
    """
    pairs = _curve_pairs(curve)
    if not pairs:
        return {
            "series": [],
            "maxDD": 0.0,
            "peakDate": None,
            "troughDate": None,
            "recoveryDate": None,
            "underwaterDays": 0,
            "episodes": [],
        }

    series = []
    peak = pairs[0][1]
    peak_date = pairs[0][0]
    max_dd = 0.0
    max_peak_date = peak_date
    max_trough_date = peak_date
    max_peak_value = peak

    # Episode tracking
    episodes = []
    ep_active = False
    ep_peak_date = None
    ep_trough_date = None
    ep_trough_dd = 0.0

    for d, v in pairs:
        if v > peak:
            # New high: close any open episode that recovered (already recovered when dd hits 0)
            peak = v
            peak_date = d
        dd = v / peak - 1.0 if peak > 0 else 0.0
        if dd > 0:
            dd = 0.0
        series.append({"d": d, "dd": dd})

        if dd < max_dd:
            max_dd = dd
            max_peak_date = peak_date
            max_trough_date = d
            max_peak_value = peak

        # Episodes: start when leaving peak (dd < 0)
        if not ep_active:
            if dd < 0:
                ep_active = True
                ep_peak_date = peak_date
                ep_trough_date = d
                ep_trough_dd = dd
        else:
            if dd < ep_trough_dd:
                ep_trough_dd = dd
                ep_trough_date = d
            # Recovered to peak
            if dd >= 0 or abs(dd) < 1e-15:
                if ep_trough_dd <= episode_threshold:
                    episodes.append({
                        "peakDate": ep_peak_date,
                        "troughDate": ep_trough_date,
                        "recoveryDate": d,
                        "depth": ep_trough_dd,
                    })
                ep_active = False
                ep_peak_date = None
                ep_trough_date = None
                ep_trough_dd = 0.0

    # Open episode at end of series
    if ep_active and ep_trough_dd <= episode_threshold:
        episodes.append({
            "peakDate": ep_peak_date,
            "troughDate": ep_trough_date,
            "recoveryDate": None,
            "depth": ep_trough_dd,
        })

    # Recovery for maxDD episode
    recovery_date = None
    if max_dd < 0 and max_peak_value > 0:
        past_trough = False
        for d, v in pairs:
            if d == max_trough_date:
                past_trough = True
                continue
            if past_trough and v >= max_peak_value:
                recovery_date = d
                break

    # Underwater days: from peak of maxDD to recovery (or end)
    date_index = {d: i for i, (d, _) in enumerate(pairs)}
    start_i = date_index.get(max_peak_date, 0)
    if recovery_date is not None:
        end_i = date_index[recovery_date]
    else:
        end_i = len(pairs) - 1 if max_dd < 0 else start_i
    underwater_days = max(0, end_i - start_i) if max_dd < 0 else 0

    return {
        "series": series,
        "maxDD": max_dd,
        "peakDate": max_peak_date if max_dd < 0 else pairs[0][0],
        "troughDate": max_trough_date if max_dd < 0 else pairs[0][0],
        "recoveryDate": recovery_date,
        "underwaterDays": underwater_days,
        "episodes": episodes,
    }


# Trading-day windows ≈ 1y / 3y / 5y / 10y
ROLLING_WINDOWS = {
    "1y": 252,
    "3y": 756,
    "5y": 1260,
    "10y": 2520,
}


def rolling_cagr(curve, window: int = 756):
    """Rolling CAGR over a trading-day window W.

    At each end index t >= W: cagr = (v[t]/v[t-W])^(252/W) - 1.
    Returns empty series when curve is shorter than window+1 points.
    """
    pairs = _curve_pairs(curve)
    n = len(pairs)
    if window <= 0 or n <= window:
        return {"series": [], "min": None, "median": None, "max": None, "window": window}

    series = []
    cagrs = []
    exp = 252.0 / window
    for t in range(window, n):
        v0 = pairs[t - window][1]
        v1 = pairs[t][1]
        if v0 <= 0 or v1 <= 0:
            continue
        cagr = (v1 / v0) ** exp - 1.0
        series.append({"d": pairs[t][0], "cagr": cagr})
        cagrs.append(cagr)

    if not cagrs:
        return {"series": [], "min": None, "median": None, "max": None, "window": window}

    cagrs_sorted = sorted(cagrs)
    mid = len(cagrs_sorted) // 2
    if len(cagrs_sorted) % 2:
        med = cagrs_sorted[mid]
    else:
        med = (cagrs_sorted[mid - 1] + cagrs_sorted[mid]) / 2.0

    return {
        "series": series,
        "min": cagrs_sorted[0],
        "median": med,
        "max": cagrs_sorted[-1],
        "window": window,
    }


# Start-date sensitivity heatmap (Batch 6): fixed end, vary start months.
SENSITIVITY_MAX_STARTS = 120
SENSITIVITY_MIN_DAYS = 20


def _sensitivity_calendar_codes(
    weights: dict,
    rebalance: str = "Q",
    cash_code: str = "153130",
    ma_overlay: bool = False,
    regime_hedge: bool = False,
    regime_hedge_mode: str = "inverse",
    regime_hedge_code: str = "114800",
    gold_on: bool = False,
    gold_code: str = "132030",
    vol_target: bool = False,
    sleeve_trend: bool = False,
) -> list[str]:
    """Codes whose intersection defines the common trading calendar (mirrors backtest)."""
    codes = [c for c, w in weights.items() if w and w > 0]
    need_cash = (
        rebalance == "DMOM"
        or ma_overlay
        or (regime_hedge and regime_hedge_mode == "cash")
        or bool(vol_target)
        or bool(sleeve_trend)
    )
    out = list(codes)
    if need_cash and cash_code not in out:
        out.append(cash_code)
    if regime_hedge:
        for extra in ("069500", "133690", regime_hedge_code if regime_hedge_mode != "cash" else cash_code):
            if extra and extra not in out:
                out.append(extra)
    if gold_on:
        g = gold_code if gold_code in ("411060", "132030") else "132030"
        for extra in (g, GOLD_CASH):
            if extra not in out:
                out.append(extra)
    return out


def _common_dates_for_codes(codes: list[str], prices: dict, end: str) -> list[str]:
    sets = []
    for c in codes:
        series = prices.get(c) or {}
        sets.append({d for d in series if d <= end})
    if not sets:
        return []
    common = set.intersection(*sets) if len(sets) > 1 else set(sets[0])
    return sorted(d for d in common if d)


def _month_first_candidates(common: list[str], min_days: int = SENSITIVITY_MIN_DAYS) -> list[tuple[str, str]]:
    """(ym, first_trading_date) for each month with >= min_days remaining to end."""
    if not common:
        return []
    first_by_ym: dict[str, str] = {}
    for d in common:
        ym = d[:7]
        if ym not in first_by_ym:
            first_by_ym[ym] = d
    n = len(common)
    # index of each date for remaining-day check
    idx = {d: i for i, d in enumerate(common)}
    out = []
    for ym in sorted(first_by_ym.keys()):
        d0 = first_by_ym[ym]
        i0 = idx[d0]
        # days on curve after start ≈ n - 1 - i0 (same as backtest days)
        if (n - 1 - i0) >= min_days:
            out.append((ym, d0))
    return out


def _subsample_starts(
    candidates: list[tuple[str, str]], max_starts: int = SENSITIVITY_MAX_STARTS
) -> tuple[list[tuple[str, str]], str]:
    """Cap runs: all monthly if under cap; else densest recent monthly window.

    If still too many after taking a recent window and the span is long, fall
    back to quarterly then yearly then even sample.
    """
    if len(candidates) <= max_starts:
        return candidates, "monthly"
    # Prefer a contiguous recent monthly block (heatmap stays dense).
    if max_starts >= 12:
        return candidates[-max_starts:], "monthly_recent"
    quarterly = [(ym, d) for ym, d in candidates if int(ym[5:7]) in (1, 4, 7, 10)]
    if len(quarterly) <= max_starts and len(quarterly) >= 2:
        return quarterly[-max_starts:], "quarterly"
    yearly = [(ym, d) for ym, d in candidates if ym.endswith("-01")]
    if len(yearly) <= max_starts and len(yearly) >= 2:
        return yearly[-max_starts:], "yearly"
    n = len(candidates)
    if max_starts <= 1:
        return [candidates[-1]], "sampled"
    idxs = sorted({round(i * (n - 1) / (max_starts - 1)) for i in range(max_starts)})
    return [candidates[i] for i in idxs], "sampled"


def start_date_sensitivity(
    weights: dict,
    prices: dict,
    end: str,
    rebalance: str = "Q",
    initial_capital: float = 1.0,
    monthly_contribution: float = 0.0,
    max_starts: int = SENSITIVITY_MAX_STARTS,
    min_days: int = SENSITIVITY_MIN_DAYS,
    **bt_kwargs,
) -> dict:
    """Ending-window CAGR/MDD across many start months (fixed end).

    Reuses ``backtest`` with varying ``start``. Returns a year×month grid of cells.
    Past simulation only — not advice.
    """
    cal = _sensitivity_calendar_codes(
        weights,
        rebalance=rebalance,
        cash_code=bt_kwargs.get("cash_code", "153130"),
        ma_overlay=bool(bt_kwargs.get("ma_overlay", False)),
        regime_hedge=bool(bt_kwargs.get("regime_hedge", False)),
        regime_hedge_mode=bt_kwargs.get("regime_hedge_mode", "inverse"),
        regime_hedge_code=bt_kwargs.get("regime_hedge_code", "114800"),
        gold_on=bool(bt_kwargs.get("gold_on", False)),
        gold_code=bt_kwargs.get("gold_code", "132030"),
        vol_target=bool(bt_kwargs.get("vol_target", False)),
        sleeve_trend=bool(bt_kwargs.get("sleeve_trend", False)),
    )
    missing = [c for c in cal if c not in prices]
    if missing:
        return {
            "error": f"시세 없음: {', '.join(missing)}",
            "end": end,
            "cells": [],
            "mode": None,
            "candidateCount": 0,
            "runCount": 0,
        }
    common = _common_dates_for_codes(cal, prices, end)
    if len(common) < min_days + 1:
        return {
            "error": "공통 거래일이 너무 짧습니다.",
            "end": end,
            "cells": [],
            "mode": None,
            "candidateCount": 0,
            "runCount": 0,
        }
    # Align end to last common date
    fixed_end = common[-1]
    candidates = _month_first_candidates(common, min_days=min_days)
    selected, mode = _subsample_starts(candidates, max_starts=max_starts)
    cells = []
    for ym, d0 in selected:
        try:
            s = backtest(
                weights,
                prices,
                start=d0,
                end=fixed_end,
                rebalance=rebalance,
                initial_capital=initial_capital,
                monthly_contribution=monthly_contribution,
                **bt_kwargs,
            )
        except Exception as e:  # noqa: BLE001 — surface as cell error
            cells.append(
                {
                    "ym": ym,
                    "year": int(ym[:4]),
                    "month": int(ym[5:7]),
                    "start": d0,
                    "end": fixed_end,
                    "cagr": None,
                    "mdd": None,
                    "days": 0,
                    "error": str(e),
                }
            )
            continue
        cells.append(
            {
                "ym": ym,
                "year": int(ym[:4]),
                "month": int(ym[5:7]),
                "start": s.start,
                "end": s.end,
                "cagr": s.cagr,
                "mdd": s.mdd,
                "days": s.days,
                "error": None,
            }
        )
    years = sorted({c["year"] for c in cells}) if cells else []
    return {
        "error": None,
        "end": fixed_end,
        "cells": cells,
        "mode": mode,
        "candidateCount": len(candidates),
        "runCount": len(selected),
        "years": years,
        "minDays": min_days,
        "maxStarts": max_starts,
    }


def main():

    raw, prices = load()
    sample = {"069500": 0.4, "133690": 0.3, "148070": 0.2, "132030": 0.1}
    available = {k: v for k, v in sample.items() if k in prices}
    s = backtest(available, prices, start="2022-01-01")
    dca = backtest(
        available,
        prices,
        start="2022-01-01",
        initial_capital=10_000_000,
        monthly_contribution=500_000,
    )
    print(json.dumps({
        "lump": {
            "start": s.start, "end": s.end,
            "cagr": round(s.cagr * 100, 2), "total": round(s.total_return * 100, 2),
            "mdd": round(s.mdd * 100, 2),
        },
        "dca": {
            "cagr": round(dca.cagr * 100, 2),
            "total": round(dca.total_return * 100, 2),
            "invested": dca.total_invested,
            "final": round(dca.final_value, 0),
            "contributions": dca.contributions,
        },
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
