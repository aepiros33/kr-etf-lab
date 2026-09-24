#!/usr/bin/env python3
"""Reviewer agent: sanity-check ingested data and backtest invariants."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from build_backtest import backtest, load, compute_drawdown, rolling_cagr, ROLLING_WINDOWS, curve_cum_return, start_date_sensitivity, SENSITIVITY_MAX_STARTS, SENSITIVITY_MIN_DAYS

ROOT = Path(__file__).resolve().parents[1]

# Must match app.js PRESETS weights exactly (sum == 100 each).
PRESETS = {
    "kAllWeather": {
        "069500": 15,
        "133690": 17.5,
        "148070": 17.5,
        "114260": 15,
        "132030": 15,
        "153130": 20,
    },
    "permanent": {
        "069500": 12.5,
        "133690": 12.5,
        "148070": 12.5,
        "114260": 12.5,
        "132030": 25,
        "153130": 25,
    },
    "global6040": {
        "133690": 40,
        "069500": 20,
        "148070": 40,
    },
    "monthlyIncome": {
        "133690": 30,
        "069500": 20,
        "148070": 30,
        "153130": 20,
    },
    "goldenButterfly": {
        "069500": 20,
        "133690": 20,
        "148070": 20,
        "153130": 20,
        "132030": 20,
    },
    "growth80": {
        "133690": 60,
        "069500": 20,
        "148070": 20,
    },
    "koreaUs": {
        "069500": 35,
        "133690": 30,
        "148070": 20,
        "153130": 15,
    },
    "divGrowth": {
        "069500": 50,
        "133690": 20,
        "148070": 15,
        "153130": 15,
    },
    "semiDefensive": {
        "069500": 40,
        "148070": 25,
        "132030": 20,
        "153130": 15,
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
    corr_codes = [c for c in ("069500", "148070", "133690") if c in prices]
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

    # --- Yearly calendar returns compound to total_return (lump-sum only) ---
    # Prior-year-end method: product(1+yearly) - 1 == total_return
    for label, stats in (("kodex_lump", s), ("mixed_lump", lump)):
        if not stats.yearly:
            fail(f"{label} missing yearly")
        acc = 1.0
        for y in sorted(stats.yearly.keys()):
            acc *= 1.0 + stats.yearly[y]
        compound = acc - 1.0
        if abs(compound - stats.total_return) > 1e-9:
            fail(
                f"{label} yearly compound {compound} != total_return {stats.total_return}"
            )
        # First/last year may be partial but must still be present and finite
        years = sorted(stats.yearly.keys())
        if abs(stats.yearly[years[0]]) > 10 or abs(stats.yearly[years[-1]]) > 10:
            fail(f"{label} implausible partial-year return")

    # --- At least 2 multi-asset presets: compound(yearly) ≈ total_return (lump) ---
    preset_checked = 0
    for pname in ("global6040", "growth80", "kAllWeather", "koreaUs"):
        pw = PRESETS.get(pname)
        if not pw:
            continue
        codes = [c for c in pw if c in prices]
        if len(codes) < 2:
            continue
        tw = {c: pw[c] / 100.0 for c in codes}
        # renormalize if some missing
        ssum = sum(tw.values())
        tw = {c: v / ssum for c, v in tw.items()}
        try:
            ps = backtest(tw, prices, start="2019-01-01", rebalance="Q")
        except Exception as e:
            fail(f"preset {pname} backtest error: {e}")
        if len(ps.curve) < 20 or not ps.yearly:
            continue
        acc = 1.0
        for y in sorted(ps.yearly.keys()):
            acc *= 1.0 + ps.yearly[y]
        compound = acc - 1.0
        if abs(compound - ps.total_return) > 1e-9:
            fail(
                f"preset {pname} yearly compound {compound} != total_return {ps.total_return}"
            )
        # Partial-year detection: start year without Jan or end without Dec
        by_y: dict[str, list[str]] = {}
        for pt in ps.curve:
            d = pt["d"] if isinstance(pt, dict) else pt[0]
            by_y.setdefault(d[:4], []).append(d)
        ys = sorted(by_y.keys())
        if ys:
            if not any(d[5:7] == "01" for d in by_y[ys[0]]) and ys[0] not in ps.yearly:
                fail(f"preset {pname} missing start-year yearly key")
            if not any(d[5:7] == "12" for d in by_y[ys[-1]]) and ys[-1] not in ps.yearly:
                fail(f"preset {pname} missing end-year yearly key")
        preset_checked += 1
        if preset_checked >= 2:
            break
    if preset_checked < 2:
        fail(f"need >=2 multi-asset presets for yearly compound; got {preset_checked}")

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


    # --- Monthly fixed rebalance smoke ---
    mixed_w = {"069500": 0.5, "114260": 0.5}
    if "114260" not in prices:
        alt = next((e["code"] for e in etfs if e.get("category") == "채권" and e["code"] in prices), None)
        if not alt:
            fail("채권 ETF 없음 — 월간 리밸런싱 테스트 불가")
        mixed_w = {"069500": 0.5, alt: 0.5}
    mixed_m = backtest(mixed_w, prices, start="2019-01-01", rebalance="M")
    if len(mixed_m.curve) < 20:
        fail("monthly rebalance curve too short")
    if abs(mixed_m.curve[0][1] - mixed_n.curve[0][1]) > 1e-9:
        fail("monthly rebalance day-0 mismatch")

    # --- Momentum: single ticker + cost 0 ≈ buy-and-hold ---
    mom_bh = backtest(
        {"069500": 1.0}, prices, start="2019-01-01",
        rebalance="MOM", mom_lookback=1, mom_top_n=1, mom_cost=0.0,
    )
    if abs(mom_bh.total_return - s.total_return) > 1e-6:
        fail(f"MOM single-ticker != BH: {mom_bh.total_return} vs {s.total_return}")
    if not mom_bh.mom_holdings or len(mom_bh.mom_holdings) < 2:
        fail("MOM should return monthly holdings list")
    for h in mom_bh.mom_holdings:
        if h.get("codes") != ["069500"]:
            fail(f"MOM single holdings unexpected: {h}")

    # --- Momentum multi: holdings present + no look-ahead (signal uses prior month) ---
    mom_uni = {c: 1.0 for c in ("069500", "133690", "148070", "132030") if c in prices}
    if len(mom_uni) >= 3:
        mom_m = backtest(
            mom_uni, prices, start="2020-01-01",
            rebalance="MOM", mom_lookback=3, mom_top_n=2, mom_cost=0.001,
        )
        if not mom_m.mom_holdings:
            fail("MOM multi missing holdings")
        for h in mom_m.mom_holdings:
            if not h.get("codes") or not h.get("month"):
                fail(f"MOM holdings row incomplete: {h}")
            if len(h["codes"]) > 2:
                fail(f"MOM topN violated: {h}")
            # Weights equal
            ws = list(h["weights"].values())
            if ws and abs(sum(ws) - 1.0) > 1e-9:
                fail(f"MOM weights not normalized: {h}")


    # --- Dual momentum (DMOM) ---
    # Single risky + cash: continuous path; cost 0 with absolute always-pass ≈ MOM when cash weaker
    if "214980" in prices:
        dmom_uni = {"069500": 1.0}
        dmom = backtest(
            dmom_uni, prices, start="2019-01-01",
            rebalance="DMOM", mom_lookback=1, mom_top_n=1, mom_cost=0.0,
            cash_code="214980",
        )
        if len(dmom.curve) < 20:
            fail("DMOM curve too short")
        for i in range(1, min(len(dmom.curve), 400)):
            pt = dmom.curve[i]
            d, v = (pt["d"], pt["v"]) if isinstance(pt, dict) else (pt[0], pt[1])
            if v <= 0:
                fail(f"DMOM non-positive value on {d}")
        if not dmom.mom_holdings or len(dmom.mom_holdings) < 2:
            fail("DMOM should return monthly holdings")
        # Cost 0 single ticker: if every month absolute passes, equals MOM; otherwise may hold cash
        mom_cmp = backtest(
            dmom_uni, prices, start="2019-01-01",
            rebalance="MOM", mom_lookback=1, mom_top_n=1, mom_cost=0.0,
        )
        # Path must remain finite; when absolute always passes (rare), ≈ MOM
        always_risky = all(
            h.get("codes") == ["069500"] for h in (dmom.mom_holdings or [])
        )
        if always_risky and abs(dmom.total_return - mom_cmp.total_return) > 1e-6:
            fail(f"DMOM always-pass should match MOM: {dmom.total_return} vs {mom_cmp.total_return}")

    # --- Inverse-vol weighting ---
    if "069500" in prices and "214980" in prices:
        inv = backtest(
            {"069500": 0.5, "214980": 0.5},
            prices,
            start="2019-01-01",
            rebalance="Q",
            weighting="invVol",
            vol_window=60,
        )
        # Spot-check invVol weights: higher-vol 069500 gets lower weight than 214980
        from build_backtest import _inv_vol_weights
        common_iv = sorted(set(prices["069500"]) & set(prices["214980"]))
        probe = next(d for d in common_iv if d >= "2022-06-01")
        ivw = _inv_vol_weights(["069500", "214980"], prices, probe, 60)
        if abs(sum(ivw.values()) - 1.0) > 1e-9:
            fail(f"invVol weights not normalized: {ivw}")
        if ivw.get("069500", 1) >= ivw.get("214980", 0):
            fail(f"invVol expected cash > equity weight at {probe}: {ivw}")
        if len(inv.curve) < 20:
            fail("invVol backtest curve too short")

    # --- MA trend overlay ---
    if "069500" in prices and "214980" in prices:
        from build_backtest import _ma_risk_on
        ma = backtest(
            {"069500": 1.0},
            prices,
            start="2019-01-01",
            rebalance="M",
            ma_overlay=True,
            ma_window=200,
            cash_code="214980",
            ma_cash_pct=1.0,
        )
        if ma.last_regime not in ("on", "off"):
            fail(f"MA overlay missing last_regime: {ma.last_regime}")
        if not ma.regime_log:
            fail("MA overlay missing regime_log")
        # Signal uses prior data only — SMA window ends before asof
        probe2 = next(d for d in sorted(prices["069500"]) if d >= "2020-06-01")
        dates_before = sorted(d for d in prices["069500"] if d < probe2)
        if len(dates_before) >= 200:
            window_dates = dates_before[-200:]
            if window_dates[-1] >= probe2:
                fail("MA window incorrectly includes asof date")
            _ = _ma_risk_on(prices["069500"], probe2, 200)
        # When risk-off occurred, path should differ from pure buy-hold; holdings include cash conceptually
        bh = backtest({"069500": 1.0}, prices, start="2019-01-01", rebalance="N")
        if any(e.get("regime") == "off" for e in ma.regime_log):
            if abs(ma.total_return - bh.total_return) < 1e-12:
                fail("MA risk-off periods should change path vs buy-hold")
            # Confirm at least one rebalance day was risk-off (cash would be 100% of target)
            if not any(e.get("regime") == "off" for e in ma.regime_log):
                fail("expected risk-off regime entry")
        for i in range(1, min(len(ma.curve), 400)):
            pt = ma.curve[i]
            d, v = (pt["d"], pt["v"]) if isinstance(pt, dict) else (pt[0], pt[1])
            if v <= 0:
                fail(f"MA overlay non-positive value on {d}")

    # --- 국면 헤지(실험): dual-MA → −1x 114800 cap 15% / cash alt; 2X forbidden ---
    from build_backtest import (
        _regime_hedge_signal,
        _apply_regime_hedge,
        _resolve_regime_hedge_code,
        REGIME_HEDGE_MAX_PCT,
        REGIME_HEDGE_INV_CODE,
    )
    try:
        _resolve_regime_hedge_code("inverse", "214980", "252670")
        fail("2X 252670 should be rejected for regime hedge")
    except ValueError:
        pass
    try:
        _resolve_regime_hedge_code("inverse", "214980", "122630")
        fail("non-114800 inverse should be rejected")
    except ValueError:
        pass
    if _resolve_regime_hedge_code("inverse", "214980", None) != REGIME_HEDGE_INV_CODE:
        fail("default inverse hedge code must be 114800")
    if _resolve_regime_hedge_code("cash", "423160", None) != "423160":
        fail("cash mode should use cash_code")

    # Cap hard-coded at 15%
    capped = _apply_regime_hedge({"069500": 1.0}, True, "114800", 0.50)
    if abs(capped.get("114800", 0) - REGIME_HEDGE_MAX_PCT) > 1e-9:
        fail(f"regime hedge cap must be {REGIME_HEDGE_MAX_PCT}: {capped}")
    if abs(capped.get("069500", 0) - (1 - REGIME_HEDGE_MAX_PCT)) > 1e-9:
        fail(f"risk sleeve scale wrong: {capped}")
    clear = _apply_regime_hedge({"069500": 1.0}, False, "114800", 0.15)
    if list(clear.keys()) != ["069500"] or abs(clear["069500"] - 1.0) > 1e-12:
        fail(f"hedge_off should leave weights unchanged: {clear}")

    if "069500" in prices and "133690" in prices and "114800" in prices:
        # Look-ahead: signal uses dates < asof only (via _ma_risk_on)
        probe = next(d for d in sorted(prices["069500"]) if d >= "2022-01-01")
        _ = _regime_hedge_signal(prices, probe, 200)
        rh = backtest(
            {"069500": 0.6, "133690": 0.4},
            prices,
            start="2021-01-01",
            rebalance="Q",
            regime_hedge=True,
            regime_hedge_mode="inverse",
            regime_hedge_pct=0.15,
            ma_window=200,
        )
        if rh.hedge_log is None or len(rh.hedge_log) < 2:
            fail("regime hedge missing hedge_log")
        if rh.hedge_active is None:
            fail("regime hedge missing hedge_active")
        # Monthly rebalance forced: more target updates than pure Q if hedge months differ
        bh = backtest(
            {"069500": 0.6, "133690": 0.4},
            prices,
            start="2021-01-01",
            rebalance="Q",
        )
        if any(e.get("hedge") for e in rh.hedge_log):
            if abs(rh.total_return - bh.total_return) < 1e-12:
                fail("active regime hedge should change path vs no-hedge")
        for i in range(1, min(len(rh.curve), 400)):
            pt = rh.curve[i]
            d, v = (pt["d"], pt["v"]) if isinstance(pt, dict) else (pt[0], pt[1])
            if v <= 0:
                fail(f"regime hedge non-positive value on {d}")

        # Cash alternative mode
        if "214980" in prices:
            rh_cash = backtest(
                {"069500": 1.0},
                prices,
                start="2021-01-01",
                rebalance="M",
                regime_hedge=True,
                regime_hedge_mode="cash",
                regime_hedge_pct=0.15,
                cash_code="214980",
                ma_window=200,
            )
            if not rh_cash.hedge_log:
                fail("cash-mode regime hedge missing hedge_log")


    # --- GOLDON (금 온/오프 슬리브) G1/G2 ---
    from build_backtest import (
        GOLD_CODE,
        GOLD_CODE_FUTURES,
        GOLD_CASH,
        GOLD_CODES_ALLOWED,
        _apply_gold_sleeve,
        _gold_signal_on,
        _lookback_return,
        _month_end_closes,
        _clamp_gold_sleeve,
        _resolve_gold_code,
    )
    # Unit: sleeve ON → 411060 == sleevePct; OFF → 411060 == 0
    on_w = _apply_gold_sleeve({"069500": 0.7, "148070": 0.3, GOLD_CODE: 0.2}, True, 0.15)
    if abs(on_w.get(GOLD_CODE, -1) - 0.15) > 1e-9:
        fail(f"G1 unit ON weight: {on_w}")
    off_w = _apply_gold_sleeve({"069500": 1.0, GOLD_CODE: 0.5}, False, 0.15)
    if abs(off_w.get(GOLD_CODE, 0.0)) > 1e-9:
        fail(f"G1 unit OFF weight: {off_w}")
    if abs(off_w.get(GOLD_CASH, 0) - 0.15) > 1e-9 and abs(sum(v for k, v in off_w.items() if k == GOLD_CASH) - 0.15) > 1e-9:
        # OFF sleeve is in cash; may merge if rest had cash — at least cash >= sleeve
        if off_w.get(GOLD_CASH, 0) + 1e-9 < 0.15:
            fail(f"G1 unit OFF cash sleeve: {off_w}")
    if abs(_clamp_gold_sleeve(0.05) - 0.10) > 1e-12 or abs(_clamp_gold_sleeve(0.99) - 0.20) > 1e-12:
        fail("gold sleeve clamp 10–20% failed")

    if GOLD_CODE in prices and GOLD_CASH in prices and "069500" in prices:
        # Universe without gold so G1 is unambiguous
        g_uni = {"069500": 0.6, "148070": 0.4} if "148070" in prices else {"069500": 1.0}
        # Drop missing
        g_uni = {c: w for c, w in g_uni.items() if c in prices}
        g = backtest(
            g_uni,
            prices,
            start="2022-01-01",
            rebalance="Q",
            gold_on=True,
            gold_sleeve_pct=0.15,
            gold_lookback=1,
            mom_cost=0.001,
        )
        if not g.gold_log or len(g.gold_log) < 2:
            fail("GOLDON missing gold_log")
        if g.gold_active is None or g.gold_holding is None:
            fail("GOLDON missing gold_active/holding")
        allowed_hold = set(GOLD_CODES_ALLOWED) | {GOLD_CASH}
        if g.gold_holding not in allowed_hold:
            fail(f"GOLDON holding unexpected: {g.gold_holding}")

        # G1: after warmup, at each monthly rebalance eval weight(411060) is 0 or sleevePct
        sleeve = 0.15
        warmup_months = 2  # prior month-end + lookback window
        for i, entry in enumerate(g.gold_log):
            if i < warmup_months:
                continue
            wmap = entry.get("weights") or {}
            w411 = float(wmap.get(GOLD_CODE, 0.0))
            if abs(w411) > 1e-9 and abs(w411 - sleeve) > 1e-9:
                fail(f"G1 month {entry.get('month')}: 411060 weight={w411} (want 0 or {sleeve})")
            on = bool(entry.get("on"))
            if on and abs(w411 - sleeve) > 1e-9:
                fail(f"G1 ON month {entry.get('month')}: w={w411}")
            if (not on) and abs(w411) > 1e-9:
                fail(f"G1 OFF month {entry.get('month')}: w={w411}")

        if g.gold_active:
            if g.gold_holding != GOLD_CODE:
                fail(f"G1 latest ON holding: {g.gold_holding}")
        else:
            if g.gold_holding != GOLD_CASH:
                fail(f"G1 latest OFF holding: {g.gold_holding}")

        # G2: every month-end price used in signal has ed[:7] < signalMonth
        me_cache = {
            GOLD_CODE: _month_end_closes(prices[GOLD_CODE]),
            GOLD_CASH: _month_end_closes(prices[GOLD_CASH]),
        }
        for entry in g.gold_log:
            sm = entry["month"]
            for code in (GOLD_CODE, GOLD_CASH):
                # mirror _lookback_return window
                from build_backtest import _shift_month
                end_ym = _shift_month(sm, -1)
                start_ym = _shift_month(end_ym, -1)
                ends = me_cache[code]
                for ym in (end_ym, start_ym):
                    if ym in ends:
                        ed, _px = ends[ym]
                        if ed[:7] >= sm:
                            fail(f"G2 look-ahead {code} ed={ed} signalMonth={sm}")
            # signal helper itself must not use look-ahead (returns bool)
            _ = _gold_signal_on(sm, 1, me_cache)

        # Path stays positive
        for i in range(1, min(len(g.curve), 400)):
            pt = g.curve[i]
            d, v = (pt["d"], pt["v"]) if isinstance(pt, dict) else (pt[0], pt[1])
            if v <= 0:
                fail(f"GOLDON non-positive value on {d}")

        # Flip cost: path with cost differs from cost=0 when flips occur
        g0 = backtest(
            g_uni, prices, start="2022-01-01", rebalance="M",
            gold_on=True, gold_sleeve_pct=0.15, gold_lookback=1, mom_cost=0.0,
        )
        g1 = backtest(
            g_uni, prices, start="2022-01-01", rebalance="M",
            gold_on=True, gold_sleeve_pct=0.15, gold_lookback=1, mom_cost=0.001,
        )
        flips = 0
        prev = None
        for e in g1.gold_log or []:
            if prev is not None and bool(e["on"]) != bool(prev):
                flips += 1
            prev = e["on"]
        if flips > 0 and abs(g0.total_return - g1.total_return) < 1e-15:
            fail("GOLDON flip cost should change path when flips>0")

        # Optional long gold futures sleeve (explicit gold_code; does not replace default)
        if GOLD_CODE_FUTURES in prices and _resolve_gold_code(None) == GOLD_CODE:
            gf = backtest(
                g_uni,
                prices,
                start="2016-09-23",
                rebalance="Q",
                gold_on=True,
                gold_sleeve_pct=0.15,
                gold_lookback=1,
                gold_code=GOLD_CODE_FUTURES,
                mom_cost=0.001,
            )
            if gf.gold_holding not in (GOLD_CODE_FUTURES, GOLD_CASH):
                fail(f"GOLDON futures holding unexpected: {gf.gold_holding}")
            if gf.start > "2017-01-01":
                fail(f"GOLDON futures 10y start too late: {gf.start}")
            for i, entry in enumerate(gf.gold_log or []):
                if i < 2:
                    continue
                wmap = entry.get("weights") or {}
                wgf = float(wmap.get(GOLD_CODE_FUTURES, 0.0))
                if abs(wgf) > 1e-9 and abs(wgf - 0.15) > 1e-9:
                    fail(f"G1 futures month {entry.get('month')}: {GOLD_CODE_FUTURES} w={wgf}")



    # --- Rebalancing band (Batch 4) ---
    # Fixed-target modes only; daily drift vs last targets; MOM/DMOM ignore band.
    from build_backtest import _clamp_band_pct, _band_drift_exceeds

    if abs(_clamp_band_pct(0.05) - 0.05) > 1e-12:
        fail("band default clamp")
    if abs(_clamp_band_pct(0.001) - 0.01) > 1e-12:
        fail("band min clamp")
    if abs(_clamp_band_pct(0.5) - 0.10) > 1e-12:
        fail("band max clamp")

    bond_band = next((e["code"] for e in etfs if e.get("category") == "채권"), None)
    if not bond_band:
        fail("채권 ETF 없음 — 밴드 테스트 불가")
    band_w = {"069500": 0.6, bond_band: 0.4}

    b_cal = backtest(band_w, prices, start="2019-01-01", rebalance="Q", band_on=False)
    b_wide = backtest(
        band_w, prices, start="2019-01-01", rebalance="Q",
        band_on=True, band_pct=0.10,
    )
    b_tight = backtest(
        band_w, prices, start="2019-01-01", rebalance="Q",
        band_on=True, band_pct=0.01,
    )
    if not b_wide.band_applied or b_cal.band_applied:
        fail("band_applied flag mismatch")
    if b_wide.band_pct is None or abs(b_wide.band_pct - 0.10) > 1e-12:
        fail(f"band_pct not recorded: {b_wide.band_pct}")
    # Tighter band should rebalance at least as often as a wide band
    if b_tight.rebal_count < b_wide.rebal_count:
        fail(
            f"tight band rebal_count {b_tight.rebal_count} < wide {b_wide.rebal_count}"
        )
    # Wide band typically fewer (or equal) than quarterly calendar
    if b_wide.rebal_count > b_cal.rebal_count + 5:
        fail(
            f"wide band rebal_count {b_wide.rebal_count} >> calendar Q {b_cal.rebal_count}"
        )
    # Continuity + weight sum after path: final value positive, mdd <= 0
    if b_wide.final_value <= 0 or b_wide.mdd > 1e-12:
        fail("band path invariant (value/mdd)")
    if b_tight.curve[0][1] <= 0:
        fail("band day0 non-positive")
    # Day-0 match calendar vs band (same start allocation)
    if abs(b_cal.curve[0][1] - b_wide.curve[0][1]) > 1e-9:
        fail("band day-0 wealth mismatch vs calendar")

    # Band + N (no calendar): still can rebalance on drift
    b_n = backtest(
        band_w, prices, start="2019-01-01", rebalance="N",
        band_on=True, band_pct=0.01,
    )
    if not b_n.band_applied:
        fail("band+N should apply band")
    if b_n.rebal_count < 1:
        fail("band+N tight should rebalance at least once on mixed port")

    # MOM ignores band flag for trigger (band_applied False)
    b_mom = backtest(
        {"069500": 1.0},
        prices,
        start="2019-01-01",
        rebalance="MOM",
        mom_lookback=1,
        mom_top_n=1,
        mom_cost=0.0,
        band_on=True,
        band_pct=0.05,
    )
    if b_mom.band_applied:
        fail("MOM must ignore band (band_applied should be False)")

    # Drift helper: synthetic equal units at target → no breach; one-sided → breach
    syn_prices = {
        "A": {"2020-01-02": 100.0},
        "B": {"2020-01-02": 100.0},
    }
    syn_units = {"A": 0.5, "B": 0.5}
    syn_tw = {"A": 0.5, "B": 0.5}
    if _band_drift_exceeds(syn_units, syn_prices, "2020-01-02", 100.0, syn_tw, 0.05):
        fail("band helper false positive at target")
    syn_units2 = {"A": 0.7, "B": 0.3}
    if not _band_drift_exceeds(syn_units2, syn_prices, "2020-01-02", 100.0, syn_tw, 0.05):
        fail("band helper false negative on 20pp drift")

    # Presets must never include inverse/leverage 114800 / 252670
    for name, w in PRESETS.items():
        if "114800" in w or "252670" in w:
            fail(f"preset {name} must not include inverse hedge codes")

    # --- Existing MOM / yearly / presets still covered above ---



    # --- Trading cost / turnover (Batch 5) ---
    from build_backtest import _clamp_trade_cost, _one_way_turnover, _current_weights

    if abs(_clamp_trade_cost(None) - 0.001) > 1e-12:
        fail("trade cost default")
    if abs(_clamp_trade_cost(-1) - 0.0) > 1e-12:
        fail("trade cost min clamp")
    if abs(_clamp_trade_cost(0.9) - 0.005) > 1e-12:
        fail("trade cost max clamp")
    if abs(_one_way_turnover({"A": 0.5, "B": 0.5}, {"A": 0.5, "B": 0.5}) - 0.0) > 1e-12:
        fail("turnover identical weights")
    # Full switch equal-weight 2→2: TO = 1.0
    if abs(_one_way_turnover({"A": 0.5, "B": 0.5}, {"C": 0.5, "D": 0.5}) - 1.0) > 1e-12:
        fail("turnover full switch")
    # Sleeve flip 15%: TO = 0.15
    if abs(_one_way_turnover({"G": 0.15, "X": 0.85}, {"C": 0.15, "X": 0.85}) - 0.15) > 1e-12:
        fail("turnover sleeve flip")

    cost_w = {"069500": 0.6, bond_band: 0.4}
    c0 = backtest(cost_w, prices, start="2019-01-01", rebalance="Q", mom_cost=0.0)
    c1 = backtest(cost_w, prices, start="2019-01-01", rebalance="Q", mom_cost=0.001)
    c2 = backtest(cost_w, prices, start="2019-01-01", rebalance="Q", mom_cost=0.005)
    if abs(c0.trade_cost - 0.0) > 1e-12:
        fail(f"trade_cost recorded 0: {c0.trade_cost}")
    if abs(c1.trade_cost - 0.001) > 1e-12:
        fail(f"trade_cost recorded 10bps: {c1.trade_cost}")
    if c0.total_cost_drag > 1e-12:
        fail("zero cost should have zero drag")
    if c1.rebal_count > 0:
        if not (c1.total_cost_drag > 0):
            fail("Q rebal with cost>0 should accumulate drag")
        if not (c1.final_value < c0.final_value - 1e-12):
            fail("cost should reduce final value vs cost=0")
        if not (c2.final_value <= c1.final_value + 1e-12):
            fail("higher cost should not increase final value")
        if not (c2.total_cost_drag + 1e-12 >= c1.total_cost_drag):
            fail("higher cost rate should not lower total drag when TO>0")

    # MOM: cost path differs when holdings change (legacy invariant, now via turnover)
    mom0 = backtest(
        {"069500": 1.0, "133690": 1.0, bond_band: 1.0},
        prices, start="2019-01-01", rebalance="MOM",
        mom_lookback=1, mom_top_n=2, mom_cost=0.0,
    )
    mom1 = backtest(
        {"069500": 1.0, "133690": 1.0, bond_band: 1.0},
        prices, start="2019-01-01", rebalance="MOM",
        mom_lookback=1, mom_top_n=2, mom_cost=0.001,
    )
    if mom1.rebal_count > 1 and abs(mom0.total_return - mom1.total_return) < 1e-15:
        # Only fail if holdings actually changed at least once
        changes = 0
        prev = None
        for h in mom1.mom_holdings or []:
            s = tuple(sorted(h.get("codes") or []))
            if prev is not None and s != prev:
                changes += 1
            prev = s
        if changes > 0:
            fail("MOM turnover cost should change path when holdings switch")

    # --- MOM12_1 / XSMOM / volTarget / sleeveTrend smoke ---
    uni5 = {
        "069500": 0.2,
        "133690": 0.2,
        "148070": 0.2,
        "132030": 0.2,
        "153130": 0.2,
    }
    m12 = backtest(uni5, prices, start="2019-01-01", rebalance="MOM12_1", mom_top_n=2, mom_cost=0.0)
    if not m12.curve or len(m12.curve) < 20:
        fail("MOM12_1 curve too short")
    if not m12.mom_holdings:
        fail("MOM12_1 should return monthly holdings")
    for h in m12.mom_holdings:
        if len(h.get("codes") or []) > 2:
            fail(f"MOM12_1 topN violated: {h}")
    xs = backtest(uni5, prices, start="2019-01-01", rebalance="XSMOM", mom_lookback=1, mom_top_n=2, mom_cost=0.0)
    if not xs.curve or len(xs.curve) < 20:
        fail("XSMOM curve too short")
    if not xs.mom_holdings:
        fail("XSMOM should return monthly holdings")
    try:
        backtest({"069500": 0.5, "133690": 0.5}, prices, start="2019-01-01", rebalance="XSMOM")
        fail("XSMOM should reject universe < 5")
    except ValueError as e:
        if "5" not in str(e):
            fail(f"XSMOM guard message unexpected: {e}")

    vt = backtest(
        {"069500": 0.6, "148070": 0.4},
        prices,
        start="2019-01-01",
        rebalance="Q",
        vol_target=True,
        vol_target_pct=0.10,
        vol_target_window=60,
        cash_code="153130",
    )
    if not vt.curve or len(vt.curve) < 20:
        fail("volTarget curve too short")
    if vt.mdd > 1e-12:
        fail(f"volTarget MDD > 0: {vt.mdd}")

    st = backtest(
        {"069500": 0.4, "133690": 0.3, "148070": 0.3},
        prices,
        start="2019-01-01",
        rebalance="M",
        sleeve_trend=True,
        sleeve_trend_mode="abs",
        sleeve_trend_lookback=1,
        cash_code="153130",
    )
    if not st.curve or len(st.curve) < 20:
        fail("sleeveTrend curve too short")
    if st.mdd > 1e-12:
        fail(f"sleeveTrend MDD > 0: {st.mdd}")

    app_js_chk = (ROOT / "app.js").read_text(encoding="utf-8")
    for needle in ("MOM12_1", "XSMOM", "volTarget", "sleeveTrend", "momentumPick12_1", "xsMomentumPick"):
        if needle not in app_js_chk:
            fail(f"JS parity needle missing: {needle}")
    idx_chk = (ROOT / "index.html").read_text(encoding="utf-8")
    if "MOM12_1" not in idx_chk or "XSMOM" not in idx_chk:
        fail("new rebalance modes missing from index.html")
    if 'id="volTarget"' not in idx_chk or 'id="sleeveTrend"' not in idx_chk:
        fail("volTarget/sleeveTrend toggles missing from index.html")

    # Price-return disclosure (no invented TR): UI must state price-return basis
    idx = (ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (ROOT / "app.js").read_text(encoding="utf-8")
    disclosure = "이 시뮬은 가격수익률 기준입니다"
    if disclosure not in idx and disclosure not in app_js:
        fail("price-return disclosure missing from UI")
    # Fake synthetic TR must stay gated (no inventing dividends without real series)
    if "hasRealTrData" not in app_js:
        fail("hasRealTrData gate missing — synthetic TR must not run without real data")

    # Batch 6: start-date sensitivity heatmap (light invariants)
    sens_w = {"069500": 0.6, bond_band: 0.4}
    sens = start_date_sensitivity(
        sens_w, prices, end="2026-09-23", rebalance="Q", max_starts=36
    )
    if sens.get("error"):
        fail(f"sensitivity error: {sens['error']}")
    if not sens.get("cells"):
        fail("sensitivity produced no cells")
    if sens["runCount"] > 36 or sens["runCount"] > SENSITIVITY_MAX_STARTS:
        fail(f"sensitivity runCount over cap: {sens['runCount']}")
    if sens["runCount"] > sens["candidateCount"]:
        fail("sensitivity runCount > candidateCount")
    ok_cells = [c for c in sens["cells"] if c.get("error") is None and c.get("cagr") is not None]
    if len(ok_cells) < 4:
        fail(f"sensitivity too few ok cells: {len(ok_cells)}")
    for c in ok_cells:
        if c["mdd"] is not None and c["mdd"] > 1e-12:
            fail(f"sensitivity MDD > 0 at {c['ym']}: {c['mdd']}")
        if c["days"] < SENSITIVITY_MIN_DAYS:
            fail(f"sensitivity days < min at {c['ym']}: {c['days']}")
    ok_sorted = sorted(ok_cells, key=lambda c: c["start"])
    for a, b in zip(ok_sorted, ok_sorted[1:]):
        # Later start (same end) must not have more trading days
        if b["days"] > a["days"] + 1:
            fail(f"sensitivity days not monotone {a['ym']}={a['days']} -> {b['ym']}={b['days']}")
    # Match full-window backtest at earliest selected start
    first = ok_sorted[0]
    full = backtest(sens_w, prices, start=first["start"], end=sens["end"], rebalance="Q")
    if abs(full.cagr - first["cagr"]) > 1e-12 or abs(full.mdd - first["mdd"]) > 1e-12:
        fail("sensitivity cell must match backtest at same start/end")
    # UI gate: button + helper + disclosure (no auto-run requirement)
    if "민감도 보기" not in app_js:
        fail("sensitivity button label missing in app.js")
    if "startDateSensitivity" not in app_js:
        fail("startDateSensitivity JS helper missing (parity)")
    if "시작일 민감도" not in app_js:
        fail("sensitivity section title missing")
    if "btnSensitivity" not in app_js:
        fail("btnSensitivity wiring missing")
    if "과거 시뮬" not in app_js or "투자 자문 아님" not in app_js:
        fail("sensitivity disclosure phrases missing")

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
