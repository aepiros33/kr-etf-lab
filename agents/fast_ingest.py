#!/usr/bin/env python3
"""Fast agent: mechanical ingest of KRX-listed ETF prices."""
from __future__ import annotations

import json
import math
import time
from datetime import datetime
from pathlib import Path

import FinanceDataReader as fdr
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "etf_prices.json"

UNIVERSE = [
    ("069500", "KODEX 200", "국내주식", "삼성자산운용", "코스피200 대표", False),
    ("102110", "TIGER 200", "국내주식", "미래에셋", "코스피200 대표", False),
    ("278530", "KODEX 200TR", "국내주식", "삼성자산운용", "배당 재투자형 코스피200", False),
    ("229200", "KODEX 코스닥150", "국내주식", "삼성자산운용", "코스닥 성장주", False),
    ("310970", "TIGER MSCI Korea TR", "국내주식", "미래에셋", "한국 시장 전체 TR", False),
    ("360750", "TIGER 미국S&P500", "해외주식", "미래에셋", "미국 대형주", False),
    ("379800", "KODEX 미국S&P500", "해외주식", "삼성자산운용", "미국 대형주", False),
    ("133690", "TIGER 미국나스닥100", "해외주식", "미래에셋", "미국 성장·기술", False),
    ("379810", "KODEX 미국나스닥100", "해외주식", "삼성자산운용", "미국 성장·기술", False),
    ("381180", "TIGER 미국필라델피아반도체", "해외주식", "미래에셋", "미국 반도체", False),
    ("458730", "TIGER 미국배당다우존스", "해외주식", "미래에셋", "미국 고배당", False),
    ("091160", "KODEX 반도체", "테마", "삼성자산운용", "국내 반도체", False),
    ("396500", "TIGER 반도체TOP10", "테마", "미래에셋", "국내 반도체 상위", False),
    ("411060", "ACE KRX금현물", "원자재", "한국투자신탁운용", "금 현물", False),
    ("114260", "KODEX 국고채3년", "채권", "삼성자산운용", "단기 국채", False),
    ("148070", "KIWOOM 국고채10년", "채권", "키움", "중장기 국채", False),
    ("365780", "ACE 국고채10년", "채권", "한국투자신탁운용", "중장기 국채", False),
    ("357870", "TIGER CD금리투자KIS(합성)", "현금성", "미래에셋", "단기 금리", False),
    ("459580", "KODEX CD금리액티브(합성)", "현금성", "삼성자산운용", "단기 금리", False),
    ("488770", "KODEX 머니마켓액티브", "현금성", "삼성자산운용", "MMF형", False),
    ("148020", "RISE 200", "국내주식", "KB", "코스피200", False),
    ("261070", "TIGER 코스닥150", "국내주식", "미래에셋", "코스닥 성장주", False),
    ("132030", "KODEX 골드선물(H)", "원자재", "삼성자산운용", "금 선물 환헤지", False),
]


def safe_float(v):
    if v is None:
        return None
    try:
        if isinstance(v, float) and math.isnan(v):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    listing = fdr.StockListing("ETF/KR")
    listing["Symbol"] = listing["Symbol"].astype(str).str.zfill(6)
    meta_map = listing.set_index("Symbol").to_dict("index")
    start = "2018-01-01"
    prices = {}
    meta = []
    for code, name, cat, issuer, blurb, lev in UNIVERSE:
        try:
            df = fdr.DataReader(code, start)
            if df is None or df.empty:
                print("EMPTY", code, name)
                continue
            df = df[~df.index.duplicated(keep="last")].sort_index()
            closes = []
            for dt, row in df.iterrows():
                c = row.get("Close")
                if pd.isna(c):
                    continue
                closes.append({"d": dt.strftime("%Y-%m-%d"), "c": float(c)})
            if len(closes) < 60:
                print("SHORT", code, name, len(closes))
                continue
            info = meta_map.get(code, {})
            prices[code] = closes
            meta.append({
                "code": code, "name": name, "category": cat, "issuer": issuer,
                "blurb": blurb, "leveraged": lev,
                "price": safe_float(info.get("Price")) or closes[-1]["c"],
                "changeRate": safe_float(info.get("ChangeRate")) or 0.0,
                "nav": safe_float(info.get("NAV")),
                "marcap": safe_float(info.get("MarCap")),
                "start": closes[0]["d"], "end": closes[-1]["d"], "n": len(closes),
            })
            print("OK", code, name, len(closes), closes[0]["d"], "->", closes[-1]["d"])
            time.sleep(0.05)
        except Exception as e:
            print("ERR", code, name, e)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "FinanceDataReader (KRX/NAVER)",
        "disclaimer": "과거 수익률은 미래 수익을 보장하지 않습니다. 투자 자문이 아닙니다.",
        "etfs": meta,
        "prices": prices,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print("saved", OUT, "etfs", len(meta), "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
