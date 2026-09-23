#!/usr/bin/env python3
"""Reviewer agent: sanity-check ingested data and backtest invariants."""
from __future__ import annotations

import sys
from pathlib import Path

from build_backtest import backtest, load

ROOT = Path(__file__).resolve().parents[1]


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


def main():
    raw, prices = load()
    etfs = raw["etfs"]
    if len(etfs) < 15:
        fail(f"ETF 수 부족: {len(etfs)}")
    for e in etfs:
        rows = raw["prices"][e["code"]]
        if len(rows) != e["n"]:
            fail(f"{e['code']} n mismatch")
        closes = [r["c"] for r in rows]
        if min(closes) <= 0:
            fail(f"{e['code']} non-positive price")
        for a, b in zip(closes, closes[1:]):
            chg = abs(b / a - 1)
            if chg > 0.45:
                print("WARN large gap", e["code"], chg)

    s = backtest({"069500": 1.0}, prices, start="2019-01-01")
    first = prices["069500"]
    ds = sorted(d for d in first if "2019-01-01" <= d <= s.end)
    raw_ret = first[ds[-1]] / first[ds[0]] - 1
    if abs(s.total_return - raw_ret) > 0.002:
        fail(f"single-asset return mismatch {s.total_return} vs {raw_ret}")
    if s.mdd > 0:
        fail("MDD should be negative or zero")
    if not (-0.8 < s.mdd <= 0):
        fail(f"implausible MDD {s.mdd}")

    mixed = backtest({"069500": 0.5, "114260": 0.5}, prices, start="2019-01-01")
    print("PASS")
    print(f"etfs={len(etfs)} kodex200_cagr={s.cagr:.2%} mdd={s.mdd:.2%} mixed_cagr={mixed.cagr:.2%}")


if __name__ == "__main__":
    main()
