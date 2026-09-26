#!/usr/bin/env python3
"""JS(app.js) ↔ Python(build_backtest.py) engine parity via node (no DOM).

- existing_cases(): 96-case grid for the price-return backtest()
  (4 portfolios × 8 rebalance modes × 3 option sets)
- dividend_cases(): golden cases for backtest_dividend / backtestDividend
Relative error tolerance 1e-9 (abs 1e-9 for values near 0).
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_backtest as bb  # noqa: E402

TOL = 1e-9

PORTFOLIOS = [
    {"069500": 15, "133690": 17.5, "148070": 17.5, "114260": 15, "132030": 15, "153130": 20},  # kAllWeather
    {"069500": 30, "133690": 30, "148070": 20, "132030": 10, "153130": 10},
    {"133690": 25, "360750": 25, "148070": 20, "132030": 15, "153130": 15},
    {"069500": 20, "161510": 20, "133690": 20, "114800": 10, "132030": 15, "153130": 15},
]
MODES = ["Q", "Y", "M", "N", "MOM", "MOM12_1", "XSMOM", "DMOM"]
OPTSETS = [
    # (js opts, py kwargs, initial, monthly, start)
    ({}, {}, 1.0, 0.0, "2015-01-01"),
    ({"weighting": "invVol", "bandOn": True, "bandPct": 0.05, "cost": 0.002, "lookback": 3, "topN": 2},
     {"weighting": "invVol", "band_on": True, "band_pct": 0.05, "mom_cost": 0.002, "mom_lookback": 3, "mom_top_n": 2},
     10_000_000.0, 500_000.0, "2019-01-01"),
    ({"maOverlay": True, "regimeHedge": True, "goldOn": True, "volTarget": True, "sleeveTrend": True},
     {"ma_overlay": True, "regime_hedge": True, "gold_on": True, "vol_target": True, "sleeve_trend": True},
     1.0, 0.0, "2016-01-01"),
]


def existing_cases():
    out = []
    for pi, w in enumerate(PORTFOLIOS):
        for m in MODES:
            for oi, (jo, po, ini, mon, st) in enumerate(OPTSETS):
                out.append({"id": f"P{pi}-{m}-O{oi}", "weights": w, "rebalance": m, "start": st, "end": "2099-12-31",
                            "initial": ini, "monthly": mon, "opts": jo, "py": po})
    return out


DIV_GOLDEN = [
    {"id": "G1-SCHD-cash-N", "weights": {"SCHD": 1}, "rebalance": "N", "start": "2016-01-01", "end": "2099-12-31",
     "initial": 100_000_000.0, "monthly": 0.0, "opts": {"mode": "cash"}},
    {"id": "G2-SCHD+458730-Q-DCA-reinvest", "weights": {"SCHD": 50, "458730": 50}, "rebalance": "Q",
     "start": "2016-01-01", "end": "2099-12-31", "initial": 10_000_000.0, "monthly": 500_000.0, "opts": {"mode": "reinvest"}},
    {"id": "G3-161510-cash-N", "weights": {"161510": 1}, "rebalance": "N", "start": "2000-01-01", "end": "2099-12-31",
     "initial": 10_000_000.0, "monthly": 0.0, "opts": {"mode": "cash"}},
    {"id": "G4-divSample-Y-cash", "weights": {"SCHD": 35, "VIG": 20, "BND": 25, "161510": 20}, "rebalance": "Y",
     "start": "2000-01-01", "end": "2099-12-31", "initial": 100_000_000.0, "monthly": 0.0, "opts": {"mode": "cash"}},
    {"id": "G5-band-reinvest-DCA", "weights": {"SCHD": 40, "BND": 30, "446720": 30}, "rebalance": "Q",
     "start": "2020-01-01", "end": "2099-12-31", "initial": 5_000_000.0, "monthly": 300_000.0,
     "opts": {"mode": "reinvest", "bandOn": True, "bandPct": 0.03, "cost": 0.002}},
]


def run_node(job: dict) -> dict:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node 미설치")
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(job, f)
        p = f.name
    r = subprocess.run([node, str(HERE / "js_parity.mjs"), p], capture_output=True, text=True, timeout=600)
    Path(p).unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError("node 실패: " + r.stderr[-2000:])
    return json.loads(r.stdout)


def _close(a, b) -> bool:
    if a is None or b is None:
        return a is b
    if isinstance(a, str) or isinstance(b, str):
        return a == b
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    if not (math.isfinite(a) and math.isfinite(b)):
        return a == b
    return abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def existing_parity() -> tuple[int, list[str]]:
    _, prices = bb.load()
    cases = existing_cases()
    job = {"prices": prices, "backtest": [{k: c[k] for k in ("weights", "start", "end", "rebalance", "initial", "monthly", "opts")} for c in cases]}
    js = run_node(job)["backtest"]
    fails = []
    for c, j in zip(cases, js):
        try:
            s = bb.backtest(c["weights"], prices, c["start"], c["end"], c["rebalance"], c["initial"], c["monthly"], etf_flags={}, **c["py"])
        except Exception as e:  # both must error
            if "error" not in j:
                fails.append(f"{c['id']}: Py error {e} / JS ok")
            continue
        if "error" in j:
            fails.append(f"{c['id']}: JS error {j['error']} / Py ok")
            continue
        pairs = {"finalValue": s.final_value, "totalRet": s.total_return, "cagr": s.cagr, "mdd": s.mdd, "vol": s.vol,
                 "sharpe": s.sharpe, "start": s.start, "end": s.end, "n": len(s.curve), "rebalCount": s.rebal_count}
        for k, v in pairs.items():
            if not _close(v, j.get(k)):
                fails.append(f"{c['id']}.{k}: py={v} js={j.get(k)}")
    return len(cases), fails


def _div_compare(cid, p: dict, j: dict, fails: list):
    for k in ("start", "end", "finalValue", "withdrawnNet", "wealth", "invested", "totalReturnIncl", "holdingsReturn",
              "cagr", "mdd", "mddHoldings", "costDrag", "rebalCount", "dcaBuyCount", "reinvestCount"):
        if not _close(p[k], j[k]):
            fails.append(f"{cid}.{k}: py={p[k]} js={j[k]}")
    pd_, jd = p["dividends"], j["dividends"]
    for k in ("totalGross", "totalTax", "totalNet"):
        if not _close(pd_[k], jd[k]):
            fails.append(f"{cid}.{k}: py={pd_[k]} js={jd[k]}")
    if len(pd_["months"]) != len(jd["months"]):
        fails.append(f"{cid}: months len {len(pd_['months'])} vs {len(jd['months'])}")
    for a, b in zip(pd_["months"], jd["months"]):
        for k in ("ym", "gross", "tax", "net", "count", "status"):
            if not _close(a[k], b[k]):
                fails.append(f"{cid}.month {a['ym']}.{k}: py={a[k]} js={b[k]}")
        if bool(a.get("inc")) != bool(b.get("inc")):
            fails.append(f"{cid}.month {a['ym']}.inc")
    for a, b in zip(pd_["years"], jd["years"]):
        for k in ("y", "gross", "tax", "net", "count", "partial", "status", "fxBar", "growthKrwPct", "growthUsdPct", "fxEffectPct"):
            if not _close(a.get(k), b.get(k)):
                fails.append(f"{cid}.year {a['y']}.{k}: py={a.get(k)} js={b.get(k)}")
    for k in ("from", "to", "gross", "tax", "net", "count", "short", "monthlyAvg", "label"):
        if not _close(pd_["ttm"][k], jd["ttm"][k]):
            fails.append(f"{cid}.ttm.{k}: py={pd_['ttm'][k]} js={jd['ttm'][k]}")
    if pd_["ttm"]["flags"] != jd["ttm"]["flags"]:
        fails.append(f"{cid}.ttm.flags")


def dividend_parity(cases=None) -> tuple[int, list[str], list[dict]]:
    cases = cases or DIV_GOLDEN
    codes = sorted({c for g in cases for c in g["weights"]})
    data = bb.load_dividend_data(codes)
    div_data = {"meta": data["meta"], "prices": data["prices"], "basis": data["basis"], "div": data["div"],
                "fx": [list(r) for r in data["fx"]] if data["fx"] else None}
    js = run_node({"prices": {}, "divData": div_data,
                   "dividend": [{k: c[k] for k in ("weights", "start", "end", "rebalance", "initial", "monthly", "opts")} for c in cases]})["dividend"]
    fails = []
    pys = []
    for c, j in zip(cases, js):
        p = bb.backtest_dividend(c["weights"], data, c["start"], c["end"], c["rebalance"], c["initial"], c["monthly"], c["opts"])
        pys.append(p)
        if "error" in p or "error" in j:
            if p.get("error") != j.get("error"):
                fails.append(f"{c['id']}: error mismatch py={p.get('error')} js={j.get('error')}")
            continue
        _div_compare(c["id"], p, j, fails)
    return len(cases), fails, pys


if __name__ == "__main__":
    n, f = existing_parity()
    print(f"existing backtest parity: {n} cases, {len(f)} fails")
    for x in f[:20]:
        print("  ", x)
    n2, f2, _ = dividend_parity()
    print(f"dividend parity: {n2} cases, {len(f2)} fails")
    for x in f2[:20]:
        print("  ", x)
    sys.exit(1 if (f or f2) else 0)
