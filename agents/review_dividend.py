#!/usr/bin/env python3
"""Reviewer checks for dividend (distribution cash-flow) mode + price-basis notice.

Called from reviewer.main() (fail() exits). Also runnable standalone.
"""
from __future__ import annotations

import bisect
import csv
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data"
sys.path.insert(0, str(HERE))
import build_backtest as bb  # noqa: E402

BANNED = ["월급", "받는다", "받는", "받을 수 있", "추천", "순위", "최고"]
REQUIRED_LABELS = ["배당락일 기준 집계", "월평균 = TTM÷12", "일반계좌 가정", "과거 기준", "2,000만원", "250만원", "22%",
                   "15.4%", "2025.1", "데이터 없음", "미확인", "커버드콜", "2023-08"]
NEW_NOTICE = "수정주가 기준(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬"
OLD_CLAIMS = ["가격수익률 기준", "분배금·세금은 반영하지 않습니다", "분배금 미포함", "분배금·세금 미반영", "가격수익률(분배금"]
FX_JUMP_WHITELIST = ("2008-", "2009-")


def _warn(msg, warns):
    warns.append(msg)
    print("WARN:", msg)


def check_notice(fail):
    """Price-mode notice: accurate wording everywhere, no false 「분배금 미반영」 claims."""
    targets = ["index.html", "app.js", "README.md", "AGENTS.md", "demo.html", "GROK_BOT_PROMPT.md"] + \
              [str(p.relative_to(ROOT)) for p in (ROOT / "docs").glob("*.md")]
    for t in targets:
        p = ROOT / t
        if not p.exists():
            continue
        s = p.read_text(encoding="utf-8")
        for old in OLD_CLAIMS:
            if old in s:
                fail(f"notice: false price-return claim 「{old}」 still in {t}")
    idx = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    if NEW_NOTICE not in idx or "수정주가 기준" not in app:
        fail("notice: 수정주가 기준 wording missing from index.html/app.js")
    for t in ("README.md", "AGENTS.md"):
        if "수정주가" not in (ROOT / t).read_text(encoding="utf-8"):
            fail(f"notice: {t} must describe 수정주가 basis")
    # TR toggle permanently off (adjusted prices already contain distributions → any add-on double counts)
    if not re.search(r"function hasRealTrData\(\) \{\s*return false;\s*\}", app):
        fail("TR gate: hasRealTrData() must return false (adjusted prices already include distributions)")
    if not re.search(r"function buildTotalReturnPrices\(priceMap, codes\) \{\s*return priceMap;\s*\}", app):
        fail("TR gate: buildTotalReturnPrices must be a no-op")
    if "estDistributions" not in app or "exitTaxRateFor" not in app:
        fail("tax model: exit tax must exclude estimated distributions (no double tax) and exempt 국내주식형")
    if 'id="trOn"' in idx:
        fail("TR toggle must not be offered in index.html")
    demo = ROOT / "demo.html"
    if demo.exists():
        ds = demo.read_text(encoding="utf-8")
        if re.search(r"state\.totalReturn\s*=\s*e\.target\.checked", ds):
            fail("demo.html: synthetic TR toggle still active (double count)")


def _load_json(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def check_data(fail, warns):
    meta = _load_json(DATA / "div_meta.json")
    etfs = {e["code"]: e for e in meta["etfs"]}
    fx = _load_json(DATA / "fx" / "USDKRW.json")["rows"]
    fx_dates = [r[0] for r in fx]
    fx_vals = [r[1] for r in fx]
    # FX sanity
    for i, (d, v) in enumerate(zip(fx_dates, fx_vals)):
        if not (700 <= v <= 2100):
            fail(f"FX out of range {d} {v}")
        if i and fx_dates[i - 1] >= d:
            fail(f"FX dates not ascending at {d}")
        if i and abs(v / fx_vals[i - 1] - 1) > 0.05 and not d.startswith(FX_JUMP_WHITELIST):
            fail(f"FX jump >5% not whitelisted {d}")
    for k in (1, len(fx_dates) // 2, len(fx_dates) - 1):
        if bb._div_fx_asof(fx_dates, fx_vals, fx_dates[k]) != fx_vals[k - 1]:
            fail("fxAsOf must return the previous row (strictly before d)")
    import datetime as _dt
    for r in fx:
        if _dt.date.fromisoformat(r[0]).weekday() >= 5:
            fail(f"FX weekend row {r[0]}")
    nverified = 0
    for code, m in etfs.items():
        pj = _load_json(ROOT / m["priceFile"])
        dj = _load_json(ROOT / m["divFile"])
        if pj.get("priceBasis") not in bb.DIV_ALLOWED_BASIS:
            fail(f"{code}: priceBasis {pj.get('priceBasis')} not raw → dividend mode FAIL")
        rows = pj["rows"]
        px = {d: c for d, c in rows}
        dates = [d for d, _ in rows]
        ev = dj["events"]
        # empirical raw-vs-adjusted drift: Yahoo Adj anchors (year-end) — raw/adj ratio must move by ≈ the distributions
        anc = [a for a in pj.get("adjAnchors", []) if a[0] in px]
        if len(anc) >= 2 and ev:
            a0, a1 = anc[0], anc[-1]
            if abs(px[a0[0]] - a0[1]) > 1e-6 * max(1, a0[1]) or abs(px[a1[0]] - a1[1]) > 1e-6 * max(1, a1[1]):
                fail(f"{code}: raw price rows differ from anchor closes (file mixed?)")
            drift = math.log((a0[1] / a0[2]) / (a1[1] / a1[2]))
            div_log = 0.0
            for e in ev:
                if a0[0] < e["ex"] <= a1[0]:
                    i = bisect.bisect_left(dates, e["ex"]) - 1
                    if i >= 0:
                        div_log += math.log(1 + e["amt"] / px[dates[i]])
            if div_log > 0.02 and drift < 0.5 * div_log:
                fail(f"{code}: raw/adj ratio drift {drift:.3f} ≪ distributions {div_log:.3f} → price file looks dividend-ADJUSTED")
        # events
        prev_ex = None
        for i, e in enumerate(ev):
            if not (e["amt"] > 0):
                fail(f"{code}: non-positive amount {e}")
            if prev_ex and e["ex"] <= prev_ex:
                fail(f"{code}: events not strictly ascending at {e['ex']}")
            if e.get("pay") and e["pay"] < e["ex"]:
                fail(f"{code}: pay < ex {e}")
            if i and (bb.date_diff_days(ev[i - 1]["ex"], e["ex"]) if hasattr(bb, "date_diff_days") else _dd(ev[i - 1]["ex"], e["ex"])) < 10 and abs(ev[i - 1]["amt"] - e["amt"]) < 1e-12:
                fail(f"{code}: duplicate-looking events within 10 days {ev[i-1]['ex']} / {e['ex']}")
            j = bisect.bisect_left(dates, e["ex"]) - 1
            if j >= 0:
                y = e["amt"] / px[dates[j]]
                if y > 0.10:
                    fail(f"{code}: event yield {y:.1%} > 10% at {e['ex']}")
                elif y > (0.07 if m["market"] == "KR" else 0.03):
                    _warn(f"{code}: event yield {y:.1%} > 3% at {e['ex']}", warns)
            prev_ex = e["ex"]
            if m["market"] == "KR":
                if not str(e.get("src", "")).startswith("kind:"):
                    fail(f"{code}: KR event without KIND filing {e}")
                import div_ingest
                kc = div_ingest.krx_calendar()
                k = bisect.bisect_left(kc, e["rec"]) - 1
                if k < 0 or kc[k] != e["ex"]:
                    fail(f"{code}: ex {e['ex']} ≠ trading day before record {e['rec']}")
            if e.get("v"):
                nverified += 1
        # schedule gaps must be declared (미확인), never silently 0.
        # KR: KIND month-by-month full search is the source of truth → Yahoo-only events must not exist.
        if m["market"] == "KR":
            if dj.get("yahooOnly"):
                fail(f"{code}: Yahoo has events KIND lacks: {dj['yahooOnly'][:3]}")
            continue
        import div_ingest
        expect = div_ingest._gap_months(ev, dj["coverage"]["from"], dj["coverage"]["to"])
        declared = {ym for g in dj.get("gaps", []) for ym in bb._div_months(g["from"] + "-01", g["to"] + "-01")}
        missing = expect - declared
        if missing:
            fail(f"{code}: schedule gaps not declared as 미확인: {sorted(missing)[:6]}")
        if m["market"] == "US":
            recent = [e for e in ev if e["ex"] >= bb._div_minus_days(dj["coverage"]["to"], 3 * 365)]
            single = [e["ex"] for e in recent if not e.get("chk")]
            if single:
                _warn(f"{code}: {len(single)} recent events without 2nd source (e.g. {single[:3]})", warns)
    # SCHD golden: Schwab official list dates all present
    src = DATA / "sources" / "schwab_SCHD_distributions.csv"
    if src.exists():
        lines = [l for l in src.read_text().splitlines() if not l.startswith("#")]
        want = {r["ex_date"] for r in csv.DictReader(lines)}
        have = {e["ex"] for e in _load_json(DATA / "dividends" / "SCHD.json")["events"]}
        if not want <= have:
            fail(f"SCHD: Schwab official ex-dates missing: {sorted(want - have)[:5]}")
        schwab_src = [e for e in _load_json(DATA / "dividends" / "SCHD.json")["events"] if e["src"] == "schwab"]
        if len(schwab_src) != len(want):
            fail(f"SCHD: expected {len(want)} schwab-sourced amounts, got {len(schwab_src)}")
    # known Yahoo defects patched
    qqq = {e["ex"]: e for e in _load_json(DATA / "dividends" / "QQQ.json")["events"]}
    if abs(qqq.get("2020-09-21", {}).get("amt", 0) - 0.38824) > 1e-9:
        fail("QQQ 2020-09-21 (Nasdaq 0.38824) not patched")
    if "2010-06-25" in qqq:
        fail("QQQ 2010-06-25 Yahoo duplicate not dropped")
    bnd = {e["ex"]: e for e in _load_json(DATA / "dividends" / "BND.json")["events"]}
    if abs(bnd.get("2017-07-03", {}).get("amt", 0) - 0.169673) > 1e-9:
        fail("BND 2017-07-03 wrong Yahoo amount not corrected")
    for code, e in etfs.items():
        if e["code"] in ("JEPI", "JEPQ", "441640") and not e.get("coveredCall"):
            fail(f"{code}: coveredCall badge flag missing")
        if e["market"] == "US" and e.get("group") != "해외 직투 비교":
            fail(f"{code}: US ETF must be in 「해외 직투 비교」 group")
    return etfs, nverified


def _dd(a, b):
    import datetime as _dt
    return (_dt.date.fromisoformat(b) - _dt.date.fromisoformat(a)).days


def check_separation(fail, etfs):
    """US ETFs never enter PRESETS / price-mode meta / momentum candidates."""
    meta = _load_json(DATA / "etf_meta.json")
    us = {c for c, e in etfs.items() if e["market"] == "US"}
    if any(e.get("market") == "US" or e["code"] in us for e in meta["etfs"]):
        fail("US ETF leaked into data/etf_meta.json (price-mode candidates)")
    import parity_check as pc
    out = pc.run_node({"presets": True, "presetWeights": True})
    for k, w in out["presetWeights"].items():
        if set(w) & us:
            fail(f"PRESETS.{k} contains US ETF")
    dp = out["presets"]["DIV_PRESETS"] or {}
    if "divSample" not in dp or "schdVsKr" not in dp:
        fail("DIV_PRESETS divSample / schdVsKr missing")
    if set(dp["divSample"]["w"]) & {"JEPI", "JEPQ", "441640"}:
        fail("sample dividend preset must not contain covered calls")
    if set(out["presets"]["PRESETS"]) & set(dp):
        fail("DIV_PRESETS must be separate from PRESETS")


def check_engine(fail, warns):
    data = bb.load_dividend_data(["SCHD", "161510", "446720", "DGRO", "BND"])
    # 1) adjusted basis refused
    bad = dict(data, basis=dict(data["basis"], SCHD="adjusted"))
    r = bb.backtest_dividend({"SCHD": 1}, bad, "2016-01-01", "2099-12-31", "N", 1.0, 0.0, {"mode": "cash"})
    if "error" not in r:
        fail("dividend engine accepted an adjusted price series")
    import parity_check as pc
    jd = {"meta": data["meta"], "prices": {"SCHD": data["prices"]["SCHD"]}, "basis": {"SCHD": "adjusted"},
          "div": {"SCHD": data["div"]["SCHD"]}, "fx": [list(x) for x in data["fx"]]}
    j = pc.run_node({"divData": jd, "dividend": [{"weights": {"SCHD": 1}, "start": "2016-01-01", "end": "2099-12-31",
                                                  "rebalance": "N", "initial": 1, "monthly": 0, "opts": {"mode": "cash"}}]})
    if "error" not in j["dividend"][0]:
        fail("JS dividend engine accepted an adjusted price series")
    # 2) cash-out buy&hold = raw price return exactly; Σ month net = totalNet; gross−tax=net; tax/gross exact
    for w in ({"SCHD": 1}, {"161510": 1}, {"SCHD": 0.6, "446720": 0.4}):
        r = bb.backtest_dividend(w, data, "2016-01-01", "2099-12-31", "N", 1e8, 0.0, {"mode": "cash"})
        codes = r["codes"]
        fx_d = [x[0] for x in data["fx"]]
        fx_v = [x[1] for x in data["fx"]]
        exp = 0.0
        for c in codes:
            us = data["meta"][c]["market"] == "US"
            p0 = data["prices"][c][r["start"]] * (bb._div_fx_asof(fx_d, fx_v, r["start"]) if us else 1)
            p1 = data["prices"][c][r["end"]] * (bb._div_fx_asof(fx_d, fx_v, r["end"]) if us else 1)
            exp += r["weights"][c] * 1e8 * p1 / p0
        if abs(r["finalValue"] / exp - 1) > 1e-12:
            fail(f"cash buy&hold {w}: final {r['finalValue']} ≠ raw price return {exp}")
        sm = sum(m["net"] for m in r["dividends"]["months"])
        if abs(sm - r["dividends"]["totalNet"]) > 1e-6 * max(1, sm):
            fail("Σ monthly net ≠ totalNet")
        for e in r["dividends"]["events"]:
            rate = 0.15 if data["meta"][e["code"]]["market"] == "US" else 0.154
            if abs(e["gross"] - e["tax"] - e["net"]) > 1e-9 * e["gross"] or abs(e["tax"] / e["gross"] - rate) > 1e-12:
                fail(f"tax arithmetic wrong at {e['code']} {e['ex']}")
            if data["meta"][e["code"]]["market"] == "US" and not (e["fx"] == bb._div_fx_asof(fx_d, fx_v, e["ex"])):
                fail("dividend FX must be the last rate strictly before ex-date")
    # 3) reinvest + zero tax + zero cost, SCHD ≈ Yahoo Adj total return (≤0.3%p/yr)
    anc = _load_json(DATA / "us" / "prices" / "SCHD.json")["adjAnchors"]
    a0 = next(a for a in anc if a[0] >= "2012-12-01")
    a1 = anc[-1]
    r = bb.backtest_dividend({"SCHD": 1}, data, a0[0], a1[0], "N", 1.0, 0.0,
                             {"mode": "reinvest", "cost": 0.0, "taxRates": {"US_DIRECT": 0.0, "KR_LISTED": 0.0}})
    fx_d = [x[0] for x in data["fx"]]
    fx_v = [x[1] for x in data["fx"]]
    usd_tr = r["wealth"] * bb._div_fx_asof(fx_d, fx_v, r["start"]) / bb._div_fx_asof(fx_d, fx_v, r["end"])
    adj_tr = a1[2] / a0[2]
    yrs = r["years"]
    diff = (usd_tr ** (1 / yrs) - adj_tr ** (1 / yrs)) * 100
    if r["start"] != a0[0] or abs(diff) > 0.3:
        fail(f"SCHD reinvest(tax0) vs Yahoo Adj: {diff:+.3f}%p/yr (start {r['start']} vs {a0[0]})")
    # 4) coverage / gaps → no_data / unverified (never 0)
    r = bb.backtest_dividend({"161510": 1}, data, "2012-01-01", "2014-12-31", "N", 1.0, 0.0, {"mode": "cash"})
    st = {m["ym"]: m["status"] for m in r["dividends"]["months"]}
    if not all(st[f"2012-{m:02d}"] == "no_data" for m in range(8, 13)) or st["2013-01"] != "ok":
        fail(f"161510 pre-coverage months must be no_data: {[(k, v) for k, v in st.items() if k < '2013-02']}")
    r = bb.backtest_dividend({"DGRO": 1}, data, "2015-01-01", "2016-12-31", "N", 1.0, 0.0, {"mode": "cash"})
    st = {m["ym"]: m["status"] for m in r["dividends"]["months"]}
    if st.get("2016-03") != "unverified":
        fail("DGRO 2016-03 gap must be 'unverified'")
    # 5) unknown year (only 데이터 없음/미확인 months, no event) → known=False (UI/CSV show —, not 0); confirmed year → known
    d2 = bb.load_dividend_data(["BIL", "161510"])
    r = bb.backtest_dividend({"BIL": 50, "161510": 50}, d2, "2012-01-01", "2016-12-31", "N", 1e8, 0.0, {"mode": "cash"})
    yk = {y["y"]: y["known"] for y in r["dividends"]["years"]}
    if yk.get("2012") is not False or yk.get("2013") is not True:
        fail(f"yearly known flags wrong (2012 must be unknown, 2013 known): {yk}")
    r = bb.backtest_dividend({"SCHD": 1}, data, "2016-01-01", "2099-12-31", "N", 1.0, 0.0, {"mode": "cash"})
    if not all(y["known"] for y in r["dividends"]["years"]) or not all(m["known"] for m in r["dividends"]["months"] if m["status"] == "ok"):
        fail("confirmed months/years must be known (true 0 stays 0)")
    return diff


def check_wording(fail):
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    idx = (ROOT / "index.html").read_text(encoding="utf-8")
    k = app.index("// ==== DIVIDEND MODE (v1) ====")
    div_js = app[k:]
    a = idx.index('id="divLayout"')
    b = idx.index("</div>\n    <p class=\"foot\">", a) if "<p class=\"foot\">" in idx else len(idx)
    div_html = idx[a:b]
    for w in BANNED:
        for src, s in (("app.js(dividend)", div_js), ("index.html(divLayout)", div_html)):
            if w in s:
                fail(f"banned wording 「{w}」 in {src}")
    for lab in REQUIRED_LABELS:
        if lab not in div_js and lab not in div_html:
            fail(f"required dividend label missing: 「{lab}」")
    if "?v=div2" not in idx or "?v=div1" in idx:
        fail("cache-bust ?v=div2 missing (or stale ?v=div1 left)")
    for need in ('id="btnDivCsv"', 'id="btnDivShare"', "divBuildCsv", "divEncodeHash", "divDecodeHash"):
        if need not in div_js:
            fail(f"dividend share/CSV UI missing: {need}")


SHARE_CASES = [
    {"preset": "divSample", "sel": {"SCHD": 35, "VIG": 20, "BND": 25, "161510": 20}, "mode": "reinvest", "taxView": "pre",
     "period": "max", "start": "", "end": "", "rebalance": "Y", "bandOn": False, "bandPct": 5, "initial": 100000000,
     "monthly": 0, "tcBps": 10},
    {"preset": None, "sel": {"SCHD": 60, "446720": 40}, "mode": "cash", "taxView": "after", "period": "custom",
     "start": "2016-01-01", "end": "2024-12-31", "rebalance": "Q", "bandOn": True, "bandPct": 3, "initial": 50000000,
     "monthly": 300000, "tcBps": 25},
    {"preset": "schdVsKr", "sel": {"SCHD": 100}, "mode": "reinvest", "taxView": "after", "period": "3y", "start": "",
     "end": "", "rebalance": "N", "bandOn": False, "bandPct": 5, "initial": 100000000, "monthly": 0, "tcBps": 0},
    {"preset": "divSample", "sel": {"SCHD": 50, "BND": 50}, "mode": "cash", "taxView": "pre", "period": "10y",
     "start": "", "end": "", "rebalance": "M", "bandOn": False, "bandPct": 5, "initial": 100000000, "monthly": 0, "tcBps": 10},
]


def check_share_csv(fail):
    """Dividend share hash round-trips every toggle; CSV has BOM/header/monthly+yearly and never writes 0 for unknown."""
    import parity_check as pc
    data = bb.load_dividend_data(["BIL", "161510", "SCHD"])
    jd = {"meta": data["meta"], "prices": data["prices"], "basis": data["basis"], "div": data["div"],
          "fx": [list(x) for x in data["fx"]]}
    etfs = _load_json(DATA / "div_meta.json")["etfs"]
    out = pc.run_node({"divShare": SHARE_CASES, "divLegacy": ["#div", "#div=divSample"], "divData": jd, "divEtfs": etfs,
                       "divCsv": [{"weights": {"BIL": 50, "161510": 50}, "start": "2012-01-01", "end": "2016-12-31",
                                   "rebalance": "N", "initial": 1e8, "monthly": 0, "opts": {"mode": "cash"}}]})
    for st, res in zip(SHARE_CASES, out["divShare"]):
        back = res["back"]
        for k, v in st.items():
            if k == "bandPct" and not st["bandOn"]:
                continue
            if back.get(k) != v:
                fail(f"dividend share round-trip: {k} {v!r} → {back.get(k)!r} (hash {res['hash']})")
        from urllib.parse import parse_qs
        keys = set(parse_qs(res["hash"]))
        if keys & {"v", "h", "preset"}:
            fail("dividend share hash must not use price-mode keys v/h/preset (would hijack price boot)")
    lg = out["divLegacy"]
    if not (lg[0] and lg[0]["legacy"] and lg[0]["preset"] is None and lg[1]["legacy"] and lg[1]["preset"] == "divSample"):
        fail(f"legacy #div / #div=divSample links must still open dividend mode: {lg}")
    csv_text = out["divCsv"][0].get("csv", "")
    if not csv_text.startswith("\ufeff"):
        fail("dividend CSV must start with UTF-8 BOM")
    lines = csv_text.lstrip("\ufeff").splitlines()
    for need in ("meta,returnBasis,", "meta,taxAssumption,", "meta,statusLegend,"):
        if not any(l.startswith(need) for l in lines):
            fail(f"dividend CSV header line missing: {need}")
    rows = list(csv.reader(lines))
    mhead = next((r for r in rows if r[:2] == ["section", "month"]), None)
    yhead = next((r for r in rows if r[:2] == ["section", "year"]), None)
    if not mhead or not yhead:
        fail("dividend CSV needs monthly + yearly sections")
    for need in ("BIL_gross", "BIL_tax", "BIL_net", "BIL_fx", "161510_gross", "total_gross", "total_tax", "total_net", "fx_usdkrw", "status"):
        if need not in mhead:
            fail(f"dividend CSV monthly column missing: {need}")
    mrows = {r[1]: dict(zip(mhead, r)) for r in rows if r and r[0] == "monthly"}
    yrows = {r[1]: dict(zip(yhead, r)) for r in rows if r and r[0] == "yearly"}
    m = mrows.get("2012-09", {})
    if m.get("161510_gross") != "데이터 없음" or m.get("BIL_gross") != "미확인" or m.get("total_gross") in ("0", "", None):
        fail(f"dividend CSV unknown month must be text, not 0: {m}")
    y = yrows.get("2012", {})
    if y.get("total_gross") in ("0", "0.0", "", None) or "데이터 없음" not in y.get("total_gross", ""):
        fail(f"dividend CSV/yearly 2012 (only 데이터 없음·미확인 months) must not be 0: {y}")
    try:
        float(yrows["2014"]["total_gross"])
    except (KeyError, ValueError):
        fail("dividend CSV known year must be numeric")


def run(fail):
    warns: list[str] = []
    check_notice(fail)
    etfs, nver = check_data(fail, warns)
    check_separation(fail, etfs)
    diff = check_engine(fail, warns)
    check_wording(fail)
    check_share_csv(fail)
    # golden byte-identical (dividend-off engines)
    import golden_price_mode as g
    gold = json.loads(g.GOLDEN.read_text())
    cur = g.current()
    if gold["fingerprint"] != cur["fingerprint"]:
        _warn("price data changed since golden snapshot — byte-identical check skipped (regenerate with --write)", warns)
    else:
        if gold["js"] != cur["js"]:
            fail("dividend-off JS backtest output differs from golden (must be byte-identical)")
        if gold["py"] != cur["py"]:
            fail("dividend-off Python backtest output differs from golden")
    import parity_check as pc
    n, f = pc.existing_parity()
    if f:
        fail(f"JS/Py parity (price engine) {len(f)}/{n} fails: {f[:3]}")
    n2, f2, _ = pc.dividend_parity()
    if f2:
        fail(f"JS/Py parity (dividend engine) {len(f2)}/{n2} fails: {f2[:3]}")
    return {"etfs": len(etfs), "verifiedEvents": nver, "schdAdjDiffPctPt": round(diff, 4), "parity": n, "divParity": n2,
            "golden": gold["commit"][:7], "warns": len(warns)}


if __name__ == "__main__":
    def _fail(m):
        print("FAIL:", m)
        sys.exit(1)
    print(json.dumps(run(_fail), ensure_ascii=False))
    print("PASS (dividend)")
