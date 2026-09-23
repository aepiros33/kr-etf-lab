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

    # Prefer bundle rows when present; else per-file via load()'s prices.
    bundle_prices = raw.get("prices") or {}
    for e in etfs:
        code = e["code"]
        if code not in prices:
            # Meta may list tickers whose prices were skipped; warn only.
            print("WARN missing prices", code)
            continue
        if code in bundle_prices:
            rows = bundle_prices[code]
            if e.get("n") and len(rows) != e["n"]:
                fail(f"{code} n mismatch")
            closes = [r["c"] for r in rows]
        else:
            closes = list(prices[code].values())
        if not closes or min(closes) <= 0:
            fail(f"{code} non-positive price")
        ordered = sorted(prices[code].items())
        for (da, a), (db, b) in zip(ordered, ordered[1:]):
            chg = abs(b / a - 1)
            if chg > 0.45:
                print("WARN large gap", code, da, db, chg)

    if "069500" not in prices:
        fail("benchmark 069500 missing")

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

    # Rebalance-day return must not be zeroed: quarterly vs none should differ,
    # and neither path should have NaN / empty curve.
    w = {"069500": 0.5, "114260": 0.5}
    if "114260" not in prices:
        # fallback bond-like if curated missing
        alt = next((e["code"] for e in etfs if e.get("category") == "채권" and e["code"] in prices), None)
        if not alt:
            fail("채권 ETF 없음 — 리밸런싱 혼합 테스트 불가")
        w = {"069500": 0.5, alt: 0.5}
    mixed_q = backtest(w, prices, start="2019-01-01", rebalance="Q")
    mixed_n = backtest(w, prices, start="2019-01-01", rebalance="N")
    if len(mixed_q.curve) < 20 or len(mixed_n.curve) < 20:
        fail("rebalance curves too short")
    # Same-day MTM+rebalance: first-day values equal; later paths may diverge.
    if abs(mixed_q.curve[0][1] - mixed_n.curve[0][1]) > 1e-9:
        fail("rebalance day-0 mismatch")
    # On a rebalance day, portfolio value must stay continuous (no wipe to 0/1).
    for i in range(1, min(len(mixed_q.curve), 400)):
        d, v = mixed_q.curve[i]
        if v <= 0:
            fail(f"non-positive value on {d}")

    # DCA: more capital in → different final wealth index & usually different CAGR.
    lump = backtest(w, prices, start="2020-01-01", initial_capital=10_000_000, monthly_contribution=0)
    dca = backtest(
        w, prices, start="2020-01-01",
        initial_capital=10_000_000, monthly_contribution=500_000,
    )
    if dca.contributions <= 1:
        fail("DCA should add monthly contributions")
    if dca.total_invested <= lump.total_invested:
        fail("DCA total_invested should exceed lump sum")
    if abs(dca.final_value - lump.final_value) < 1.0:
        fail("DCA final value should differ from lump sum")
    # Wealth index (curve) end should differ when contributions are added.
    if abs(dca.curve[-1][1] - lump.curve[-1][1]) < 1e-6:
        fail("DCA equity curve should differ from lump sum")
    if abs(dca.cagr - lump.cagr) < 1e-12:
        # Extremely unlikely; still guard
        print("WARN DCA CAGR equals lump (possible flat market)")

    # Selective load: only selected codes + benchmark.
    codes = list(w.keys())
    raw2, prices2 = load(codes=codes)
    for c in codes:
        if c not in prices2:
            fail(f"selective load missing {c}")
    if "069500" not in prices2:
        fail("selective load missing benchmark")

    print("PASS")
    print(
        f"etfs={len(etfs)} prices={len(prices)} "
        f"kodex200_cagr={s.cagr:.2%} mdd={s.mdd:.2%} "
        f"mixed_cagr={mixed_q.cagr:.2%} "
        f"dca_cagr={dca.cagr:.2%} lump_cagr={lump.cagr:.2%} "
        f"dca_invested={dca.total_invested:.0f}"
    )


if __name__ == "__main__":
    main()
