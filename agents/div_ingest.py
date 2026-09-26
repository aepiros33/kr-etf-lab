#!/usr/bin/env python3
"""Fast agent: dividend-mode data (raw prices + real distribution events + USDKRW).

Mechanical ingest only — never invents prices or amounts.
  data/us/prices/{T}.json     US ETF close, split-adjusted, NOT dividend-adjusted (Yahoo auto_adjust=False)
  data/prices_raw/{code}.json KR ETF raw close (Yahoo {code}.KS auto_adjust=False) — dividend mode only
  data/dividends/{code}.json  distribution events (US: issuer/Nasdaq/stockanalysis/Yahoo merged; KR: KRX KIND filings)
  data/fx/USDKRW.json         FRED DEXKOUS (Fed H.10 noon NY buying rate) + Yahoo KRW=X tail (src "y")
  data/div_meta.json          list of dividend-mode tickers (market, group, coverage, gaps …)

Existing data/etf_prices.json · etf_meta.json · data/prices/ are NOT touched
(those are FDR/NAVER 수정주가 — distribution-adjusted — and must never feed dividend mode).
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kind_div  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
US_START = "2005-01-01"
FX_START = "2004-01-01"

US = [
    # code, name, issuer, category, coveredCall
    ("SCHD", "Schwab U.S. Dividend Equity ETF", "Schwab", "해외주식", False),
    ("VYM", "Vanguard High Dividend Yield ETF", "Vanguard", "해외주식", False),
    ("DGRO", "iShares Core Dividend Growth ETF", "iShares", "해외주식", False),
    ("VIG", "Vanguard Dividend Appreciation ETF", "Vanguard", "해외주식", False),
    ("HDV", "iShares Core High Dividend ETF", "iShares", "해외주식", False),
    ("JEPI", "JPMorgan Equity Premium Income ETF", "JPMorgan", "해외주식", True),
    ("JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", "JPMorgan", "해외주식", True),
    ("SPY", "SPDR S&P 500 ETF Trust", "State Street", "해외주식", False),
    ("QQQ", "Invesco QQQ Trust", "Invesco", "해외주식", False),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "iShares", "채권", False),
    ("BND", "Vanguard Total Bond Market ETF", "Vanguard", "채권", False),
    ("BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "State Street", "현금성", False),
]
KR = [
    # code, current name (= current KIND company name), category, coveredCall, coverage_from, note
    ("446720", "SOL 미국배당다우존스", "해외주식", False, None, None),
    ("458730", "TIGER 미국배당다우존스", "해외주식", False, None, None),
    ("402970", "ACE 미국배당다우존스", "해외주식", False, None,
     "2023-07까지 기초지수 S&P 미국고배당(舊 KINDEX/ACE 미국고배당S&P) → 2023-08부터 다우존스 배당100. 미국배당다우존스 비교는 2023-08 이후만 의미"),
    ("489250", "KODEX 미국배당다우존스", "해외주식", False, None, None),
    ("161510", "PLUS 고배당주", "국내주식", False, "2013-01-01", "KIND 수집 시작 2013-01 → 2012-08~12는 데이터 없음 · 舊 ARIRANG 고배당주"),
    ("279530", "KODEX 고배당주", "국내주식", False, None, "舊 KODEX 고배당"),
    ("441640", "KODEX 미국배당커버드콜액티브", "해외주식", True, None, "舊 KODEX 미국배당프리미엄액티브"),
]


def _yf_hist(sym: str, retries: int = 4) -> pd.DataFrame:
    for a in range(retries):
        try:
            h = yf.Ticker(sym).history(period="max", auto_adjust=False, actions=True)
            if h is not None and not h.empty:
                h.index = pd.to_datetime(h.index.tz_localize(None).date)
                return h
        except Exception as e:  # pragma: no cover
            print("  yf retry", sym, e)
        time.sleep(2 ** a)
    raise SystemExit(f"Yahoo fetch failed: {sym}")


def _anchors(h: pd.DataFrame, start: str) -> list:
    h = h[h.index >= start]
    ye = h.groupby(h.index.year).tail(1)
    out = [[str(d.date()), round(float(r["Close"]), 6), round(float(r["Adj Close"]), 6)] for d, r in ye.iterrows()]
    return out


def _rows(h: pd.DataFrame, start: str, nd: int) -> list:
    c = h.loc[h.index >= start, "Close"]
    c = c[(c.notna()) & (c > 0)]
    c = c[c.index.dayofweek < 5]
    return [[str(d.date()), round(float(v), nd)] for d, v in c.items()]


def _months_between(a: str, b: str) -> list[str]:
    return [str(p) for p in pd.period_range(a[:7], b[:7], freq="M")]


def _nasdaq(t: str) -> list[dict]:
    try:
        r = requests.get(f"https://api.nasdaq.com/api/quote/{t}/dividends?assetclass=etf", headers={**UA, "Accept": "application/json"}, timeout=25)
        rows = ((r.json().get("data") or {}).get("dividends") or {}).get("rows") or []
    except Exception as e:
        print("  nasdaq err", t, e)
        return []
    out = []
    for x in rows:
        try:
            ex = datetime.strptime(x["exOrEffDate"], "%m/%d/%Y").strftime("%Y-%m-%d")
            amt = float(x["amount"].replace("$", "").replace(",", ""))
        except Exception:
            continue
        def dd(k):
            try:
                return datetime.strptime(x.get(k) or "", "%m/%d/%Y").strftime("%Y-%m-%d")
            except Exception:
                return None
        out.append(dict(ex=ex, amt=amt, rec=dd("recordDate"), pay=dd("paymentDate")))
    return out


def _stockanalysis(t: str) -> list[dict]:
    try:
        r = requests.get(f"https://stockanalysis.com/etf/{t.lower()}/dividend/", headers=UA, timeout=25)
        tbl = pd.read_html(io.StringIO(r.text))[0]
    except Exception as e:
        print("  stockanalysis err", t, e)
        return []
    out = []
    for _, x in tbl.iterrows():
        try:
            ex = pd.to_datetime(x["Ex-Dividend Date"]).strftime("%Y-%m-%d")
            amt = float(str(x["Cash Amount"]).replace("$", "").replace(",", ""))
        except Exception:
            continue
        def dd(k):
            try:
                return pd.to_datetime(x[k]).strftime("%Y-%m-%d")
            except Exception:
                return None
        out.append(dict(ex=ex, amt=amt, rec=dd("Record Date"), pay=dd("Pay Date")))
    return out


def _issuer(t: str, splits: list) -> tuple[list[dict], str | None]:
    p = DATA / "sources" / f"schwab_{t}_distributions.csv"
    if not p.exists():
        return [], None
    lines = [l for l in p.read_text().splitlines() if not l.startswith("#")]
    out = []
    for r in csv.DictReader(lines):
        f = 1.0
        for sd, ratio in splits:
            if sd > r["ex_date"]:
                f *= ratio
        out.append(dict(ex=r["ex_date"], rec=r["record_date"], pay=r["pay_date"], amt=float(r["amount_native"]) / f))
    return out, "schwab"


def build_us(t, name, issuer, cat, cc):
    print("US", t)
    h = _yf_hist(t)
    splits = [[str(d.date()), float(v)] for d, v in h["Stock Splits"].items() if v and v > 0]
    rows = _rows(h, US_START, 6)
    first = rows[0][0]
    last = rows[-1][0]
    yahoo = [dict(ex=str(d.date()), amt=round(float(v), 6)) for d, v in h["Dividends"].items() if v and v > 0]
    nas = _nasdaq(t)
    time.sleep(0.8)
    sa = _stockanalysis(t)
    iss, iss_name = _issuer(t, splits)
    sources = [("yahoo", yahoo)] + ([("nasdaq", nas)] if nas else []) + ([("stockanalysis", sa)] if sa else []) + ([(iss_name, iss)] if iss else [])
    prio = {"yahoo": 0, "stockanalysis": 1, "nasdaq": 2, "schwab": 3}
    # drop Yahoo same-amount duplicates within 10 days (e.g. QQQ 2010-06-25) → month becomes 미확인
    dup_months = set()
    yy = []
    for e in yahoo:
        if yy and (pd.Timestamp(e["ex"]) - pd.Timestamp(yy[-1]["ex"])).days < 10 and abs(e["amt"] - yy[-1]["amt"]) < 1e-9:
            others = [x for n, s in sources if n != "yahoo" for x in s if x["ex"] == e["ex"]]
            if not others:
                dup_months.add(e["ex"][:7])
                print("  drop suspected Yahoo duplicate", t, e)
                continue
        yy.append(e)
    sources[0] = ("yahoo", yy)
    events: list[dict] = []
    for src, lst in sources:
        for e in lst:
            match = None
            for ev in events:
                dd = abs((pd.Timestamp(ev["ex"]) - pd.Timestamp(e["ex"])).days)
                if dd <= 3 and src not in ev["_s"]:
                    if match is None or dd < abs((pd.Timestamp(match["ex"]) - pd.Timestamp(e["ex"])).days):
                        match = ev
            if match is None:
                match = {"ex": e["ex"], "_s": {}}
                events.append(match)
            match["_s"][src] = e
    out = []
    for ev in events:
        s = ev["_s"]
        best = max(s, key=lambda k: prio[k])
        b = s[best]
        rec = next((s[k].get("rec") for k in sorted(s, key=lambda k: -prio[k]) if s[k].get("rec")), None)
        pay = next((s[k].get("pay") for k in sorted(s, key=lambda k: -prio[k]) if s[k].get("pay")), None)
        chk = {k: v["amt"] for k, v in s.items() if k != best}
        agree = any(abs(v - b["amt"]) / b["amt"] <= 0.01 for v in chk.values()) if chk else False
        o = {"ex": b["ex"], "amt": round(b["amt"], 6), "src": best}
        if rec:
            o["rec"] = rec
        if pay:
            o["pay"] = pay
        if chk:
            o["chk"] = {k: round(v, 6) for k, v in chk.items()}
        o["v"] = 1 if agree else 0
        out.append(o)
    out.sort(key=lambda e: e["ex"])
    out = [e for e in out if first <= e["ex"] <= last]
    cov_from = first
    gaps = _gap_months(out, cov_from, last) | {m for m in dup_months if m >= cov_from[:7]}
    freq = _freq(out)
    return {
        "price": {"code": t, "market": "US", "currency": "USD", "priceBasis": "raw_split_adjusted",
                  "source": "yahoo:auto_adjust=False (Close, split-adjusted, dividends NOT adjusted)",
                  "splits": splits, "adjAnchors": _anchors(h, US_START), "rows": rows},
        "div": {"code": t, "currency": "USD", "taxProfile": "US_DIRECT", "frequency": freq,
                "coverage": {"from": cov_from, "to": last}, "gaps": annotate_gaps(t, _gap_ranges(gaps)),
                "sources": sorted({e["src"] for e in out} | {k for e in out for k in e.get("chk", {})}),
                "events": out},
        "meta": {"code": t, "name": name, "market": "US", "currency": "USD", "group": "해외 직투 비교", "issuer": issuer,
                 "category": cat, "coveredCall": cc, "leveraged": False, "taxProfile": "US_DIRECT",
                 "start": first, "end": last, "n": len(rows), "divCount": len(out), "frequency": freq},
    }


def _freq(events: list[dict]) -> str:
    if not events:
        return "-"
    last = pd.Timestamp(events[-1]["ex"])
    n = sum(1 for e in events if pd.Timestamp(e["ex"]) > last - pd.Timedelta(days=365))
    return "M" if n >= 10 else ("Q" if n >= 3 else ("S" if n >= 2 else "A"))


def _gap_months(events: list[dict], cov_from: str, cov_to: str) -> set[str]:
    """Months where the regular schedule expects an event but none is recorded (→ 미확인).

    Day-based: an interval longer than 1.6 × the local median interval is a gap; the months
    where the schedule would have put the missing event(s) are flagged. Schedule shifts
    (e.g. month-end → mid-month record date, January paid in late December) are not gaps.
    """
    if len(events) < 3:
        return set()
    ts = [pd.Timestamp(e["ex"]) for e in events]
    iv = [(ts[i] - ts[i - 1]).days for i in range(1, len(ts))]
    gaps = set()
    for i in range(1, len(ts)):
        d = iv[i - 1]
        w = [iv[j] for j in range(max(0, i - 5), min(len(iv), i + 4)) if j != i - 1]
        med = float(pd.Series(w).median()) if w else d
        if med <= 0 or d <= 1.6 * med:
            continue
        step = max(1, round(med / 30.44))
        m = pd.Period(ts[i - 1], freq="M") + step
        end = pd.Period(ts[i], freq="M")
        while m < end:
            gaps.add(str(m))
            m = m + step
    # January distribution brought forward into December (2 events in Dec) is not a gap
    cnt = pd.Series([e["ex"][:7] for e in events]).value_counts().to_dict()
    gaps = {g for g in gaps if cnt.get(str(pd.Period(g, freq="M") - 1), 0) < 2}
    return {g for g in gaps if cov_from[:7] <= g <= cov_to[:7]}


GAP_NOTES = {
    "BIL": "초저금리 기간(분배 없음 가능성 높음) — 소스 간 확인 불가라 0이 아닌 미확인 처리",
    ("QQQ", "2010-06"): "Yahoo 2010-06-25 0.089 = 06-18과 동일 금액 중복 의심 → 제거, 월 미확인",
    ("QQQ", "2005-09"): "2005년 분배 주기 변경기 — 소스 미확인",
    ("TLT", "2012-11"): "Yahoo·Nasdaq 모두 이벤트 없음 — 미확인",
    ("DGRO", "2016-03"): "Yahoo·Nasdaq·stockanalysis 모두 이벤트 없음 — 미확인",
}


def annotate_gaps(code: str, ranges: list[dict]) -> list[dict]:
    for g in ranges:
        n = GAP_NOTES.get((code, g["from"])) or GAP_NOTES.get(code)
        if n:
            g["reason"] = n
    return ranges


def _gap_ranges(gaps: set[str]) -> list[dict]:
    out = []
    for g in sorted(gaps):
        if out and (pd.Period(out[-1]["to"], freq="M") + 1) == pd.Period(g, freq="M"):
            out[-1]["to"] = g
        else:
            out.append({"from": g, "to": g, "reason": "정기 일정 대비 이벤트 없음(소스 간 미확인)"})
    return out


def build_kr(code, name, cat, cc, cov_override, note, idx):
    print("KR", code, name)
    h = _yf_hist(f"{code}.KS")
    rows = _rows(h, "2000-01-01", 4)
    dates = [r[0] for r in rows]
    first, last = dates[0], dates[-1]
    ev = kind_div.parse_events(idx, code, name)
    yahoo = {str(d.date()): float(v) for d, v in h["Dividends"].items() if v and v > 0}
    out = []
    import bisect
    for e in ev:
        i = bisect.bisect_left(dates, e["rec"]) - 1
        if i < 0:
            continue
        ex = dates[i]
        o = {"ex": ex, "rec": e["rec"], "pay": e["pay"], "amt": e["amt"], "src": f"kind:{e['acpt']}", "kindName": e["name"]}
        if ex in yahoo:
            o["chk"] = {"yahoo": yahoo[ex]}
        o["v"] = 1
        out.append(o)
    out = [e for e in out if first <= e["ex"] <= last]
    cov_from = cov_override or first
    kind_ex = [pd.Timestamp(e["ex"]) for e in out]
    yahoo_only = [{"ex": d0, "amt": a} for d0, a in sorted(yahoo.items())
                  if cov_from <= d0 and not any(abs((pd.Timestamp(d0) - k).days) <= 3 for k in kind_ex)]
    freq = _freq(out)
    d = {"code": code, "currency": "KRW", "taxProfile": "KR_LISTED", "frequency": freq,
         "coverage": {"from": cov_from, "to": last}, "gaps": [],
         "gapPolicy": "KIND 월별 전수 검색 기준: 공시 없는 달 = 무분배(국내 고배당 ETF는 연1회·분기·월 전환 등 일정이 불규칙해 일정 기반 미확인 추정은 하지 않음). Yahoo에만 있는 이벤트는 yahooOnly에 기록(리뷰 FAIL)",
         "yahooOnly": yahoo_only,
         "sources": ["kind"], "exDateRule": "기준일 직전 KRX 거래일(T+2 결제)", "events": out}
    if note:
        d["note"] = note
    meta = {"code": code, "name": name, "market": "KR", "currency": "KRW", "group": "국내상장 배당", "category": cat,
            "coveredCall": cc, "leveraged": False, "taxProfile": "KR_LISTED", "start": first, "end": last,
            "n": len(rows), "divCount": len(out), "frequency": freq}
    if code == "402970":
        meta["validFrom"] = "2023-08-01"
    if note:
        meta["note"] = note
    return {
        "price": {"code": code, "market": "KR", "currency": "KRW", "priceBasis": "raw",
                  "source": f"yahoo:{code}.KS auto_adjust=False (Close, raw)", "adjAnchors": _anchors(h, "2000-01-01"), "rows": rows},
        "div": d, "meta": meta,
    }


def build_fx():
    print("FX")
    cache = ROOT / ".cache" / "fred_DEXKOUS.csv"
    text = None
    for a in range(3):
        try:
            r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXKOUS", headers=UA, timeout=30)
            if r.ok and "DEXKOUS" in r.text[:200]:
                text = r.text
                cache.parent.mkdir(exist_ok=True)
                cache.write_text(text)
                break
        except Exception as e:
            print("  FRED retry", e)
        time.sleep(3)
    if text is None:
        if not cache.exists():
            raise SystemExit("FRED DEXKOUS unavailable and no cache")
        print("  FRED unreachable → using cached", cache)
        text = cache.read_text()
    f = pd.read_csv(io.StringIO(text), na_values=".").dropna()
    f.columns = ["d", "v"]
    f = f[f.d >= FX_START]
    rows = [[d, round(float(v), 4)] for d, v in zip(f.d, f.v)]
    last = rows[-1][0]
    y = _yf_hist("KRW=X")["Close"]
    y = y[(y.index > last) & (y.index.dayofweek < 5)]
    for d, v in y.items():
        if v and v > 0:
            rows.append([str(d.date()), round(float(v), 4), "y"])
    return {"pair": "USDKRW", "source": "fred:DEXKOUS (Fed H.10 noon NY buying rate)", "tailSource": "yahoo:KRW=X (rows marked 'y')",
            "fredLast": last, "rows": rows}


def dump(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-kind-crawl", action="store_true", help="use cached KIND index only")
    ap.add_argument("--kr-only", action="store_true", help="rebuild KR files only (keep US/FX), update div_meta")
    args = ap.parse_args()
    if args.kr_only:
        return kr_only(args)
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    fx = build_fx()
    dump(DATA / "fx" / "USDKRW.json", {**fx, "generatedAt": now})
    idx_path = kind_div.CACHE / "index.json"
    if args.skip_kind_crawl and idx_path.exists():
        idx = json.loads(idx_path.read_text())
    else:
        idx = kind_div.crawl({k[1] for k in KR})
    metas = []
    for t in US:
        b = build_us(*t)
        dump(DATA / "us" / "prices" / f"{t[0]}.json", {**b["price"], "generatedAt": now})
        dump(DATA / "dividends" / f"{t[0]}.json", {**b["div"], "generatedAt": now})
        metas.append({**b["meta"], "coverage": b["div"]["coverage"], "gaps": b["div"]["gaps"],
                      "priceFile": f"data/us/prices/{t[0]}.json", "divFile": f"data/dividends/{t[0]}.json"})
        time.sleep(0.5)
    for k in KR:
        b = build_kr(*k, idx)
        dump(DATA / "prices_raw" / f"{k[0]}.json", {**b["price"], "generatedAt": now})
        dump(DATA / "dividends" / f"{k[0]}.json", {**b["div"], "generatedAt": now})
        metas.append({**b["meta"], "coverage": b["div"]["coverage"], "gaps": b["div"]["gaps"],
                      "priceFile": f"data/prices_raw/{k[0]}.json", "divFile": f"data/dividends/{k[0]}.json"})
    meta = {
        "generatedAt": now,
        "note": "배당 모드 전용 데이터. 원가격(분할만 조정) + 실제 분배 이벤트. 수정주가(data/prices, etf_prices.json)와 섞지 않음.",
        "sources": {
            "usPrices": "Yahoo Finance auto_adjust=False Close",
            "usDividends": "Schwab 공식(SCHD) > Nasdaq API > stockanalysis.com(S&P Global MI) > Yahoo (우선순위, chk에 대조값)",
            "krPrices": "Yahoo Finance {code}.KS auto_adjust=False Close (원가격)",
            "krDividends": "KRX KIND ETF이익금분배신고(분배금안내) 공시 (접수번호 src)",
            "fx": "FRED DEXKOUS + Yahoo KRW=X tail",
        },
        "fx": {"file": "data/fx/USDKRW.json", "from": fx["rows"][0][0], "to": fx["rows"][-1][0], "fredLast": fx["fredLast"]},
        "etfs": metas,
    }
    dump(DATA / "div_meta.json", meta)
    for m in metas:
        print(f"  {m['code']:7s} {m['start']}~{m['end']} div={m['divCount']} freq={m['frequency']} gaps={[(g['from'], g['to']) for g in m['gaps']]}")


def kr_only(args):
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    idx_path = kind_div.CACHE / "index.json"
    idx = json.loads(idx_path.read_text()) if (args.skip_kind_crawl and idx_path.exists()) else kind_div.crawl({k[1] for k in KR})
    meta = json.loads((DATA / "div_meta.json").read_text(encoding="utf-8"))
    by = {e["code"]: i for i, e in enumerate(meta["etfs"])}
    for k in KR:
        b = build_kr(*k, idx)
        dump(DATA / "prices_raw" / f"{k[0]}.json", {**b["price"], "generatedAt": now})
        dump(DATA / "dividends" / f"{k[0]}.json", {**b["div"], "generatedAt": now})
        meta["etfs"][by[k[0]]] = {**b["meta"], "coverage": b["div"]["coverage"], "gaps": [],
                                  "priceFile": f"data/prices_raw/{k[0]}.json", "divFile": f"data/dividends/{k[0]}.json"}
        print(f"  {k[0]} div={b['meta']['divCount']} yahooOnly={b['div']['yahooOnly']}")
    dump(DATA / "div_meta.json", meta)


if __name__ == "__main__":
    main()
