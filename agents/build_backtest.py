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
    q = lambda m: (int(m) - 1) // 3
    return py != cy or q(pm) != q(cm)


def _is_new_month(prev, cur) -> bool:
    if prev is None:
        return False
    return prev[:7] != cur[:7]


def backtest(
    weights: dict[str, float],
    prices: dict,
    start="2018-01-01",
    end="2099-12-31",
    rebalance="Q",
    initial_capital: float = 1.0,
    monthly_contribution: float = 0.0,
):
    codes = [c for c, w in weights.items() if w > 0]
    if not codes:
        raise ValueError("empty")
    if initial_capital <= 0:
        raise ValueError("initial_capital must be positive")
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

    for d in common:
        px = {c: prices[c][d] for c in codes}
        if units is None:
            # Day 0: deploy initial capital to target weights.
            units = {c: (tw[c] * value) / px[c] for c in codes}
            value = sum(units[c] * px[c] for c in codes)
        else:
            # 1) Mark to market
            value = sum(units[c] * px[c] for c in codes)
            if prev_value is not None and prev_value > 0:
                rets.append(value / prev_value - 1.0)

            # 2) Monthly DCA cash inflow on first trading day of new month
            do_rebal = _is_rebal(prev, d, rebalance)
            if monthly_contribution > 0 and _is_new_month(prev, d):
                value += monthly_contribution
                total_invested += monthly_contribution
                contributions += 1
                do_rebal = True  # deploy cash to target weights

            # 3) Rebalance after MTM (+ optional cash)
            if do_rebal:
                units = {c: (tw[c] * value) / px[c] for c in codes}
                value = sum(units[c] * px[c] for c in codes)

        peak = max(peak, value)
        mdd = min(mdd, value / peak - 1.0)
        curve.append((d, value))
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

    # Yearly calendar returns on wealth path (indexed to initial capital).
    yearly = {}
    by_year = {}
    for d, v in curve:
        by_year.setdefault(d[:4], []).append(v / initial_capital)
    for y, vs in by_year.items():
        yearly[y] = vs[-1] / vs[0] - 1.0

    vol = statistics.stdev(rets) * (252 ** 0.5) if len(rets) > 2 else 0.0
    rf = 0.03 / 252
    excess = [r - rf for r in rets]
    mean_ex = sum(excess) / len(excess) if excess else 0
    std = statistics.stdev(rets) if len(rets) > 2 else 0
    sharpe = (mean_ex / std) * (252 ** 0.5) if std else 0.0
    ys = list(yearly.values())
    # Curve stored as wealth index (÷ initial) so charts start near 1.0
    curve_idx = [(d, v / initial_capital) for d, v in curve]
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
