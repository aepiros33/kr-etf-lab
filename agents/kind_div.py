#!/usr/bin/env python3
"""KRX KIND (public disclosure site, no login) — ETF distribution filings.

Parses 'ETF이익금분배신고(분배금안내)' filings (per-ETF docs before 2021, 일괄공시 tables after)
into record_date / pay_date / amount_krw / acpt_no. Mechanical only (Fast role): no
interpretation, no invented amounts. Cache: .cache/kind/ (gitignored).
"""
from __future__ import annotations

import html
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "kind"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
BASE = "https://kind.krx.co.kr"


def doc_text(acpt: str) -> str:
    v = requests.get(f"{BASE}/common/disclsviewer.do", params={"method": "search", "acptno": acpt}, headers=UA, timeout=20).text
    docs = re.findall(r"option value='(\d+)\|Y'", v)
    if not docs:
        return ""
    c = requests.get(f"{BASE}/common/disclsviewer.do", params={"method": "searchContents", "docNo": docs[0]}, headers=UA, timeout=20).text
    m = re.search(r"setPath\('[^']*','([^']+)'", c)
    if not m:
        return ""
    b = requests.get(m.group(1), headers=UA, timeout=20).content
    t = None
    for enc in ("utf-8", "cp949"):
        try:
            t = b.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    t = t or b.decode("utf-8", "ignore")
    t = re.sub(r"<style.*?</style>", " ", t, flags=re.S)
    t = re.sub(r"</t[dh]>", " | ", t)
    t = re.sub(r"</tr>", "\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t\xa0]+", " ", t)


def search_month(frm: str, to: str, rep: str = "이익금분배신고") -> list[tuple[str, str, str]]:
    res: list[tuple[str, str, str]] = []
    page = 1
    while True:
        r = requests.post(
            f"{BASE}/disclosure/details.do",
            headers={**UA, "Referer": f"{BASE}/disclosure/details.do?method=searchDetailsMain", "X-Requested-With": "XMLHttpRequest"},
            data=dict(method="searchDetailsSub", currentPageSize=50, pageIndex=page, orderMode=1, orderStat="D", forward="details_sub",
                      disclosureType01="", reportNm=rep, fromDate=frm, toDate=to, searchCodeType="", repIsuSrtCd="", isurCd="", searchCorpName=""),
            timeout=30,
        ).text
        rows = [
            (a, html.unescape(t).strip(), html.unescape(c).strip())
            for c, a, t in re.findall(
                r"companysummary_open\('[^']*'\); return false;\" title='([^']*)'.*?openDisclsViewer\('(\d+)',''\)\" title='([^']*)'", r, re.S
            )
        ]
        res += rows
        if len(rows) < 50 or page > 20:
            break
        page += 1
        time.sleep(0.4)
    return res


def crawl(names: set[str], start_ym: str = "2013-01", end_ym: str | None = None, refresh_last: int = 2) -> dict:
    """Month-by-month index of filings (cached). Fetch doc bodies for batch filings and for
    per-ETF filings whose company name is in `names` (current KIND names, spaces ignored)."""
    import pandas as pd

    CACHE.mkdir(parents=True, exist_ok=True)
    idx_path = CACHE / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    end_ym = end_ym or pd.Timestamp.today().strftime("%Y-%m")
    months = [str(p) for p in pd.period_range(start_ym, end_ym, freq="M")]
    norm = {n.replace(" ", "") for n in names}
    for i, key in enumerate(months):
        if key in idx and i < len(months) - refresh_last:
            hits = idx[key]
        else:
            p = pd.Period(key)
            hits = search_month(p.start_time.strftime("%Y-%m-%d"), p.end_time.strftime("%Y-%m-%d"))
            idx[key] = hits
            idx_path.write_text(json.dumps(idx, ensure_ascii=False))
        for a, t, c in hits:
            fp = CACHE / f"{a}.txt"
            if fp.exists():
                continue
            if "일괄" not in t and c.replace(" ", "") not in norm:
                continue
            try:
                fp.write_text(doc_text(a))
            except Exception as e:  # network hiccup → retry next run
                print("KIND err", a, e)
            time.sleep(0.3)
    return idx


def parse_events(idx: dict, code: str, kind_name: str) -> list[dict]:
    rows: list[dict] = []
    pat = re.compile(r"KR7" + code + r"\w{3}\|([^|]*)\|(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})\|([\d,\.]+)\|")
    for hits in idx.values():
        for a, t, c in hits:
            fp = CACHE / f"{a}.txt"
            if not fp.exists():
                continue
            txt = re.sub(r"\s*\|\s*", "|", re.sub(r"\s+", " ", fp.read_text()))
            got = [
                dict(name=m.group(1).strip(), rec=m.group(2), pay=m.group(3), amt=float(m.group(4).replace(",", "")))
                for m in pat.finditer(txt)
            ]
            if not got and "일괄" not in t and c.replace(" ", "") == kind_name.replace(" ", ""):
                m = re.search(r"지급기준일\|(\d{4}-\d{2}-\d{2})\|[^|]*지급예정일\|(\d{4}-\d{2}-\d{2})\|[^|]*분배금\(원\)\|([\d,\.]+)\|", txt)
                if m:
                    got = [dict(name=c, rec=m.group(1), pay=m.group(2), amt=float(m.group(3).replace(",", "")))]
            for r in got:
                r["acpt"] = a
                rows.append(r)
    # latest filing (정정) wins per record date
    best: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: (r["rec"], r["acpt"])):
        best[r["rec"]] = r
    return [best[k] for k in sorted(best)]
