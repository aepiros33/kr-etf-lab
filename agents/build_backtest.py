#!/usr/bin/env python3
"""Build agent: portfolio backtest engine (source of truth for review)."""
from __future__ import annotations

import json
import statistics
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "etf_prices.json"


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


def load():
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    prices = {}
    for code, rows in raw["prices"].items():
        prices[code] = {r["d"]: r["c"] for r in rows}
    return raw, prices


def backtest(weights: dict[str, float], prices: dict, start="2018-01-01", end="2099-12-31", rebalance="Q"):
    codes = [c for c, w in weights.items() if w > 0]
    if not codes:
        raise ValueError("empty")
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

    def is_rebal(prev, cur):
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

    units = None
    value = 1.0
    peak = 1.0
    mdd = 0.0
    curve = []
    rets = []
    prev = None
    for d in common:
        px = {c: prices[c][d] for c in codes}
        if units is None:
            units = {c: (tw[c] * value) / px[c] for c in codes}
        else:
            value = sum(units[c] * px[c] for c in codes)
            if is_rebal(prev, d):
                units = {c: (tw[c] * value) / px[c] for c in codes}
        value = sum(units[c] * px[c] for c in codes)
        peak = max(peak, value)
        mdd = min(mdd, value / peak - 1.0)
        if prev is not None:
            rets.append(value / curve[-1][1] - 1.0)
        curve.append((d, value))
        prev = d

    yearly = {}
    by_year = {}
    for d, v in curve:
        by_year.setdefault(d[:4], []).append(v)
    for y, vs in by_year.items():
        yearly[y] = vs[-1] / vs[0] - 1.0

    start_v, end_v = curve[0][1], curve[-1][1]
    days = len(curve) - 1
    years = days / 252.0
    total = end_v / start_v - 1.0
    cagr = (end_v / start_v) ** (1 / years) - 1 if years > 0 else 0.0
    vol = statistics.stdev(rets) * (252 ** 0.5) if len(rets) > 2 else 0.0
    rf = 0.03 / 252
    excess = [r - rf for r in rets]
    mean_ex = sum(excess) / len(excess) if excess else 0
    std = statistics.stdev(rets) if len(rets) > 2 else 0
    sharpe = (mean_ex / std) * (252 ** 0.5) if std else 0.0
    ys = list(yearly.values())
    return Stats(
        start=curve[0][0], end=curve[-1][0], days=days, years=years,
        total_return=total, cagr=cagr, mdd=mdd, vol=vol, sharpe=sharpe,
        best_year=max(ys) if ys else None, worst_year=min(ys) if ys else None,
        yearly=yearly, curve=curve,
    )


def main():
    raw, prices = load()
    sample = {"069500": 0.4, "360750": 0.3, "148070": 0.2, "411060": 0.1}
    available = {k: v for k, v in sample.items() if k in prices}
    s = backtest(available, prices, start="2022-01-01")
    print(json.dumps({
        "start": s.start, "end": s.end,
        "cagr": round(s.cagr * 100, 2), "total": round(s.total_return * 100, 2),
        "mdd": round(s.mdd * 100, 2), "vol": round(s.vol * 100, 2),
        "sharpe": round(s.sharpe, 2),
        "yearly": {k: round(v * 100, 2) for k, v in s.yearly.items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
