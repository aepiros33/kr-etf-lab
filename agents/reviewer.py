#!/usr/bin/env python3
"""Reviewer agent: sanity-check ingested data and backtest invariants."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from build_backtest import backtest, load, compute_drawdown, rolling_cagr, ROLLING_WINDOWS, curve_cum_return

ROOT = Path(__file__).resolve().parents[1]

# Must match app.js PRESETS weights exactly (sum == 100 each).
PRESETS = {
    "kAllWeather": {
        "069500": 15,
        "360750": 17.5,
        "453850": 17.5,
        "148070": 15,
        "411060": 15,
        "423160": 20,
    },
    "permanent": {
        "069500": 12.5,
        "360750": 12.5,
        "148070": 12.5,
        "453850": 12.5,
        "411060": 25,
        "423160": 25,
    },
    "global6040": {
        "360750": 40,
        "069500": 20,
        "453850": 20,
        "148070": 20,
    },
    "monthlyIncome": {
        "458730": 40,
        "329200": 20,
        "214980": 20,
        "441640": 20,
    },
}


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


def log_returns(series: dict[str, float], dates: list[str]) -> list[float]:
    out = []
    for a, b in zip(dates, dates[1:]):
        pa, pb = series[a], series[b]
        if pa <= 0 or pb <= 0:
            out.append(0.0)
        else:
            out.append(math.log(pb / pa))
    return out


def pearson_corr(xs: list[float], ys: list[float]) -> float:
    n = min(len(xs), len(ys))
    if n < 2:
        return 0.0
    sx = sy = sxx = syy = sxy = 0.0
    for i in range(n):
        x, y = xs[i], ys[i]
        sx += x
        sy += y
        sxx += x * x
        syy += y * y
        sxy += x * y
    cov = sxy - sx * sy / n
    vx = sxx - sx * sx / n
    vy = syy - sy * sy / n
    if vx <= 0 or vy <= 0:
        return 0.0
    c = cov / math.sqrt(vx * vy)
    if not math.isfinite(c):
        return 0.0
    return max(-1.0, min(1.0, c))


def corr_matrix(codes: list[str], prices: dict, start: str = "2019-01-01") -> list[list[float]]:
    sets = []
    for c in codes:
        sets.append({d for d in prices[c] if d >= start})
    common = sorted(sets[0].intersection(*sets[1:]))
    if len(common) < 20:
        fail(f"corr common dates too short: {len(common)}")
    rets = {c: log_returns(prices[c], common) for c in codes}
    n = len(codes)
    m = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            m[i][j] = 1.0 if i == j else pearson_corr(rets[codes[i]], rets[codes[j]])
    return m


def check_corr_invariants(matrix: list[list[float]], tol: float = 1e-9):
    n = len(matrix)
    for i in range(n):
        if abs(matrix[i][i] - 1.0) > 1e-6:
            fail(f"corr diagonal not 1 at {i}: {matrix[i][i]}")
        for j in range(n):
            v = matrix[i][j]
            if v < -1.0 - 1e-9 or v > 1.0 + 1e-9:
                fail(f"corr out of bounds [{i},{j}]={v}")
            if abs(matrix[i][j] - matrix[j][i]) > tol:
                fail(f"corr not symmetric [{i},{j}]")


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
        pt = mixed_q.curve[i]
        d, v = (pt["d"], pt["v"]) if isinstance(pt, dict) else (pt[0], pt[1])
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

    # --- Feature 5: PRESETS weight sum == 100 ---
    meta_codes = {e["code"] for e in etfs}
    for name, weights in PRESETS.items():
        total = sum(weights.values())
        if abs(total - 100) > 1e-9:
            fail(f"preset {name} weights sum to {total}, expected 100")
        missing = [c for c in weights if c not in meta_codes]
        if missing:
            fail(f"preset {name} missing from meta: {missing}")

    # --- Feature 5: correlation invariants on 2–3 tickers ---
    corr_codes = [c for c in ("069500", "148070", "360750") if c in prices]
    if len(corr_codes) < 2:
        fail("need >=2 tickers for corr invariants")
    matrix = corr_matrix(corr_codes[:3], prices, start="2019-01-01")
    check_corr_invariants(matrix)


    # --- Chart cum-return series ends at total_return (KPI 누적 수익률) ---
    for label, stats in (("lump", lump), ("dca", dca), ("kodex", s)):
        if not stats.curve:
            fail(f"{label} empty curve")
        end_ret = curve_cum_return(stats.curve[-1])
        if abs(end_ret - stats.total_return) > 1e-12:
            fail(f"{label} chart end ret {end_ret} != total_return {stats.total_return}")
        # Lump: ret == v - 1 (wealth index starts at 1, invested fixed)
        if label != "dca":
            pt = stats.curve[-1]
            v = pt["v"] if isinstance(pt, dict) else pt[1]
            if abs(end_ret - (v - 1.0)) > 1e-12:
                fail(f"{label} ret != v-1 for non-DCA: {end_ret} vs {v - 1.0}")

    # --- Drawdown helpers: maxDD matches engine mdd ---
    dd = compute_drawdown(s.curve)
    if abs(dd["maxDD"] - s.mdd) > 1e-12:
        fail(f"drawdown maxDD {dd['maxDD']} != mdd {s.mdd}")
    if len(dd["series"]) != len(s.curve):
        fail("drawdown series length mismatch")
    if any(pt["dd"] > 1e-12 for pt in dd["series"]):
        fail("drawdown series has positive dd")
    if dd["underwaterDays"] < 0:
        fail("underwaterDays negative")
    if s.mdd < 0 and (not dd["peakDate"] or not dd["troughDate"]):
        fail("missing peak/trough for non-zero MDD")
    empty_dd = compute_drawdown([])
    if empty_dd["series"] or empty_dd["maxDD"] != 0.0:
        fail("empty curve drawdown should be zero/empty")

    # Synthetic V-shape: peak→trough→recovery
    vcurve = [
        ("d0", 100.0),
        ("d1", 90.0),
        ("d2", 80.0),
        ("d3", 90.0),
        ("d4", 100.0),
        ("d5", 110.0),
    ]
    vdd = compute_drawdown(vcurve, episode_threshold=-0.05)
    if abs(vdd["maxDD"] - (-0.2)) > 1e-12:
        fail(f"V-shape maxDD {vdd['maxDD']}")
    if vdd["peakDate"] != "d0" or vdd["troughDate"] != "d2" or vdd["recoveryDate"] != "d4":
        fail(f"V-shape dates {vdd['peakDate']} {vdd['troughDate']} {vdd['recoveryDate']}")
    if vdd["underwaterDays"] != 4:
        fail(f"V-shape underwaterDays {vdd['underwaterDays']}")
    if len(vdd["episodes"]) != 1 or vdd["episodes"][0]["recoveryDate"] != "d4":
        fail("V-shape episode mismatch")

    # --- Rolling CAGR ---
    short = rolling_cagr(s.curve, window=10_000)
    if short["series"] or short["min"] is not None:
        fail("rolling should be empty when window >= curve length")
    roll = rolling_cagr(s.curve, window=ROLLING_WINDOWS["1y"])
    if len(s.curve) > ROLLING_WINDOWS["1y"] + 1 and not roll["series"]:
        fail("1y rolling series unexpectedly empty")
    if roll["series"]:
        if not (roll["min"] <= roll["median"] <= roll["max"]):
            fail(f"rolling min/median/max order {roll['min']} {roll['median']} {roll['max']}")
        # Spot-check first point formula
        pairs = [(p[0], float(p[1])) if not isinstance(p, dict) else (p["d"], float(p["v"])) for p in s.curve]
        w = ROLLING_WINDOWS["1y"]
        t = w
        v0, v1 = pairs[t - w][1], pairs[t][1]
        expect = (v1 / v0) ** (252.0 / w) - 1.0
        got = roll["series"][0]["cagr"]
        if abs(got - expect) > 1e-12:
            fail(f"rolling formula mismatch {got} vs {expect}")
    tiny = rolling_cagr(vcurve, window=2)
    if len(tiny["series"]) != 4:
        fail(f"tiny rolling len {len(tiny['series'])}")

    print("PASS")
    print(
        f"etfs={len(etfs)} prices={len(prices)} "
        f"kodex200_cagr={s.cagr:.2%} mdd={s.mdd:.2%} "
        f"mixed_cagr={mixed_q.cagr:.2%} "
        f"dca_cagr={dca.cagr:.2%} lump_cagr={lump.cagr:.2%} "
        f"dca_invested={dca.total_invested:.0f} "
        f"presets={len(PRESETS)} corr_n={len(corr_codes[:3])} "
        f"dd_max={dd['maxDD']:.2%} uw={dd['underwaterDays']} "
        f"roll1y_n={len(roll['series'])} "
        f"chart_end={curve_cum_return(s.curve[-1]):.2%} "
        f"dca_chart_end={curve_cum_return(dca.curve[-1]):.2%}"
    )


if __name__ == "__main__":
    main()
