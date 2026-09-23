#!/usr/bin/env python3
"""Build agent: portfolio backtest engine (source of truth for review).

Rebalancing: same-day mark-to-market THEN rebalance (do not zero rebalance-day returns).
Monthly DCA: on first trading day of each month, add cash then buy to target weights.
"""
from __future__ import annotations

import json
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

    # Per-file overrides / fills (selective load)
    if PRICES_DIR.exists():
        files = list(PRICES_DIR.glob("*.json"))
        for path in files:
            code = path.stem
            if want is not None and code not in want:
                continue
            if code in prices:
                continue
            rows = json.loads(path.read_text(encoding="utf-8"))
            prices[code] = {r["d"]: r["c"] for r in rows}

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
    if rebalance in ("M", "MOM"):
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
):
    codes = [c for c, w in weights.items() if w > 0]
    if not codes:
        raise ValueError("empty")
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive")
    if rebalance == "MOM" and not codes:
        raise ValueError("모멘텀 유니버스가 비어 있습니다. ETF를 선택하세요.")
    total_w = sum(weights[c] for c in codes)
    tw = {c: weights[c] / total_w for c in codes}
    calendars = []
    for c in codes:
        ds = sorted(d for d in prices[c] if start <= d <= end)
        if len(ds) < 20:
            raise ValueError(f"{c} 데이터 부족")
        calendars.append(set(ds))
    common = sorted(set.intersection(*calendars))
    if len(common) < 20:
        raise ValueError("공통 기간이 너무 짧습니다")

    lookback = 3 if int(mom_lookback) >= 3 else 1
    top_n = max(1, int(mom_top_n))
    cost = max(0.0, float(mom_cost))
    month_ends_cache = {c: _month_end_closes(prices[c]) for c in codes} if rebalance == "MOM" else {}

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

    for d in common:
        # Price map for currently held names (MOM may hold a subset)
        hold = active_codes if units is not None else codes
        if units is None:
            # Day 0
            if rebalance == "MOM":
                picked, current_tw = _momentum_pick(
                    codes, prices, d[:7], lookback, top_n, month_ends_cache
                )
                active_codes = picked
                units = {c: (current_tw[c] * value) / prices[c][d] for c in active_codes}
                prev_holdings = set(active_codes)
                mom_holdings.append({
                    "month": d[:7],
                    "codes": list(active_codes),
                    "weights": dict(current_tw),
                })
            else:
                units = {c: (tw[c] * value) / prices[c][d] for c in codes}
                active_codes = list(codes)
                current_tw = dict(tw)
            value = sum(units[c] * prices[c][d] for c in active_codes)
        else:
            # 1) Mark to market
            value = sum(units[c] * prices[c][d] for c in active_codes)
            if prev_value is not None and prev_value > 0:
                rets.append((d, value / prev_value - 1.0))

            # 2) Monthly DCA cash inflow on first trading day of new month
            do_rebal = _is_rebal(prev, d, rebalance)
            if monthly_contribution > 0 and _is_new_month(prev, d):
                value += monthly_contribution
                total_invested += monthly_contribution
                contributions += 1
                do_rebal = True  # deploy cash to target weights

            # 3) Rebalance after MTM (+ optional cash)
            if do_rebal:
                if rebalance == "MOM":
                    picked, new_tw = _momentum_pick(
                        codes, prices, d[:7], lookback, top_n, month_ends_cache
                    )
                    new_set = set(picked)
                    if prev_holdings is not None and new_set != prev_holdings and cost > 0:
                        value *= 1.0 - cost
                    current_tw = new_tw
                    active_codes = picked
                    units = {c: (current_tw[c] * value) / prices[c][d] for c in active_codes}
                    prev_holdings = new_set
                    mom_holdings.append({
                        "month": d[:7],
                        "codes": list(active_codes),
                        "weights": dict(current_tw),
                    })
                else:
                    units = {c: (tw[c] * value) / prices[c][d] for c in codes}
                    active_codes = list(codes)
                    current_tw = dict(tw)
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
        mom_holdings=mom_holdings if rebalance == "MOM" else None,
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


def main():
    raw, prices = load()
    sample = {"069500": 0.4, "360750": 0.3, "148070": 0.2, "411060": 0.1}
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
