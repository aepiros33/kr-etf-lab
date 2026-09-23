#!/usr/bin/env python3
"""Fast agent: mechanical ingest of KRX-listed ETF prices.

Stores metadata for ~top N ETFs by market cap, and price series as:
  - data/etf_meta.json          (lightweight list for UI)
  - data/prices/{code}.json     (per-ticker series for selective load)
  - data/etf_prices.json        (combined bundle for reviewer / offline)

UI should load meta first, then only selected tickers + benchmark 069500.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from datetime import datetime
from pathlib import Path

import FinanceDataReader as fdr
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
META_OUT = DATA / "etf_meta.json"
PRICES_DIR = DATA / "prices"
BUNDLE_OUT = DATA / "etf_prices.json"
BENCH = "069500"
TOP_N = 80
START = "2015-01-01"  # enable ≥10y backtests (need ≤2016-09-23)

# Curated names/blurbs for well-known tickers (optional overrides).
CURATED = {
    "069500": ("KODEX 200", "국내주식", "삼성자산운용", "코스피200 대표", False),
    "102110": ("TIGER 200", "국내주식", "미래에셋", "코스피200 대표", False),
    "278530": ("KODEX 200TR", "국내주식", "삼성자산운용", "배당 재투자형 코스피200", False),
    "229200": ("KODEX 코스닥150", "국내주식", "삼성자산운용", "코스닥 성장주", False),
    "360750": ("TIGER 미국S&P500", "해외주식", "미래에셋", "미국 대형주", False),
    "379800": ("KODEX 미국S&P500", "해외주식", "삼성자산운용", "미국 대형주", False),
    "133690": ("TIGER 미국나스닥100", "해외주식", "미래에셋", "미국 성장·기술", False),
    "379810": ("KODEX 미국나스닥100", "해외주식", "삼성자산운용", "미국 성장·기술", False),
    "091160": ("KODEX 반도체", "테마", "삼성자산운용", "국내 반도체", False),
    "396500": ("TIGER 반도체TOP10", "테마", "미래에셋", "국내 반도체 상위", False),
    "411060": ("ACE KRX금현물", "원자재", "한국투자신탁운용", "금 현물", False),
    "132030": ("KODEX 골드선물(H)", "원자재", "삼성자산운용", "금 선물·환헤지(H) · 장기 시세 프록시", False),
    "139320": ("TIGER 금은선물(H)", "원자재", "미래에셋", "금·은 선물·환헤지(H)", False),
    "319640": ("TIGER 골드선물(H)", "원자재", "미래에셋", "금 선물·환헤지(H)", False),
    "148070": ("KIWOOM 국고채10년", "채권", "키움", "중장기 국채", False),
    "114260": ("KODEX 국고채3년", "채권", "삼성자산운용", "단기 국채", False),
    "357870": ("TIGER CD금리투자KIS(합성)", "현금성", "미래에셋", "단기 금리", False),
    "459580": ("KODEX CD금리액티브(합성)", "현금성", "삼성자산운용", "단기 금리", False),
}

# FDR Category code → UI category fallback.
FDR_CAT = {
    1: "국내주식",
    2: "테마",
    3: "테마",
    4: "해외주식",
    5: "원자재",
    6: "채권",
    7: "현금성",
}

ISSUER_PREFIX = [
    ("KODEX", "삼성자산운용"),
    ("TIGER", "미래에셋"),
    ("ACE", "한국투자신탁운용"),
    ("RISE", "KB"),
    ("KIWOOM", "키움"),
    ("HANARO", "NH"),
    ("SOL", "신한"),
    ("PLUS", "흥국"),
    ("TIMEFOLIO", "타임폴리오"),
    ("KOSEF", "키움"),
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


def guess_issuer(name: str) -> str:
    for prefix, issuer in ISSUER_PREFIX:
        if name.upper().startswith(prefix):
            return issuer
    return "기타"


def classify(name: str, fdr_cat) -> tuple[str, bool]:
    """Return (category, leveraged)."""
    n = name.upper()
    leveraged = bool(re.search(r"레버리지|인버스|2X|3X|-2X", name, re.I))
    if re.search(r"CD금리|KOFR|머니마켓|MMF|초단기|단기채권|파킹", name, re.I):
        return "현금성", leveraged
    if re.search(r"국고|채권|회사채|종합채권|금리", name, re.I) and "주식" not in name:
        return "채권", leveraged
    if re.search(r"금현물|골드|은선물|원유|WTI|구리|원자재", name, re.I):
        return "원자재", leveraged
    if re.search(
        r"미국|S&P|나스닥|중국|일본|유럽|인도|대만|홍콩|베트남|글로벌|세계|MSCI World|선진국",
        name,
        re.I,
    ):
        return "해외주식", leveraged
    if re.search(
        r"반도체|2차전지|바이오|AI|로봇|방산|배당|커버드콜|코스닥|은행|자동차|에너지|친환경|헬스케어",
        name,
        re.I,
    ):
        return "테마", leveraged
    try:
        cat = FDR_CAT.get(int(fdr_cat), "국내주식")
    except (TypeError, ValueError):
        cat = "국내주식"
    return cat, leveraged


def pick_universe(listing: pd.DataFrame, top_n: int) -> list[str]:
    df = listing.copy()
    df["Symbol"] = df["Symbol"].astype(str).str.zfill(6)
    df["MarCap"] = pd.to_numeric(df["MarCap"], errors="coerce").fillna(0)
    ranked = df.sort_values("MarCap", ascending=False)
    codes = []
    seen = set()
    # Always keep benchmark + curated liquid names first.
    for code in [BENCH, *CURATED.keys()]:
        if code in set(df["Symbol"]) and code not in seen:
            codes.append(code)
            seen.add(code)
    for code in ranked["Symbol"].tolist():
        if code in seen:
            continue
        codes.append(code)
        seen.add(code)
        if len(codes) >= top_n:
            break
    if BENCH not in seen:
        codes.insert(0, BENCH)
    return codes[: max(top_n, len(codes))]


def fetch_closes(code: str, start: str) -> list[dict]:
    df = fdr.DataReader(code, start)
    if df is None or df.empty:
        return []
    df = df[~df.index.duplicated(keep="last")].sort_index()
    closes = []
    for dt, row in df.iterrows():
        c = row.get("Close")
        if pd.isna(c):
            continue
        closes.append({"d": dt.strftime("%Y-%m-%d"), "c": float(c)})
    return closes


def main():
    parser = argparse.ArgumentParser(description="Ingest KRX ETF meta + prices")
    parser.add_argument("--top", type=int, default=TOP_N, help="top N by market cap")
    parser.add_argument("--start", default=START)
    parser.add_argument(
        "--codes",
        default="",
        help="comma-separated codes to force-include (still capped by --top after curated)",
    )
    parser.add_argument(
        "--skip-prices",
        action="store_true",
        help="write meta only (no price download)",
    )
    parser.add_argument(
        "--only",
        action="store_true",
        help="fetch only --codes (skip top-N universe pick); requires --codes",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="merge fetched prices/meta into existing etf_prices.json + price files "
        "(do not wipe other tickers)",
    )
    args = parser.parse_args()

    listing = fdr.StockListing("ETF/KR")
    listing["Symbol"] = listing["Symbol"].astype(str).str.zfill(6)
    meta_map = listing.set_index("Symbol").to_dict("index")

    force = [c.strip().zfill(6) for c in args.codes.split(",") if c.strip()]
    if args.only:
        if not force:
            raise SystemExit("--only requires --codes")
        codes = force
    else:
        codes = pick_universe(listing, args.top)
        for c in force:
            if c not in codes:
                codes.append(c)

    DATA.mkdir(parents=True, exist_ok=True)
    PRICES_DIR.mkdir(parents=True, exist_ok=True)

    prices = {}
    meta = []
    for code in codes:
        info = meta_map.get(code, {})
        raw_name = str(info.get("Name") or code)
        if code in CURATED:
            name, cat, issuer, blurb, lev = CURATED[code]
        else:
            name = raw_name
            cat, lev = classify(name, info.get("Category"))
            issuer = guess_issuer(name)
            blurb = cat

        closes = []
        if not args.skip_prices:
            try:
                closes = fetch_closes(code, args.start)
            except Exception as e:
                print("ERR", code, name, e)
                continue
            if len(closes) < 60:
                print("SHORT", code, name, len(closes))
                continue
            (PRICES_DIR / f"{code}.json").write_text(
                json.dumps(closes, ensure_ascii=False), encoding="utf-8"
            )
            prices[code] = closes
            print("OK", code, name, len(closes), closes[0]["d"], "->", closes[-1]["d"])
            time.sleep(0.05)
        else:
            # Meta-only path: keep placeholder dates if prior file exists.
            prior = PRICES_DIR / f"{code}.json"
            if prior.exists():
                closes = json.loads(prior.read_text(encoding="utf-8"))
                prices[code] = closes

        entry = {
            "code": code,
            "name": name,
            "category": cat,
            "issuer": issuer,
            "blurb": blurb,
            "leveraged": lev,
            "price": safe_float(info.get("Price")) or (closes[-1]["c"] if closes else None),
            "changeRate": safe_float(info.get("ChangeRate")) or 0.0,
            "nav": safe_float(info.get("NAV")),
            "marcap": safe_float(info.get("MarCap")),
            "start": closes[0]["d"] if closes else None,
            "end": closes[-1]["d"] if closes else None,
            "n": len(closes),
        }
        meta.append(entry)

    # Prefer selected-only loading: meta is always available; prices may be per-file.
    meta_payload = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": "FinanceDataReader (KRX/NAVER)",
        "disclaimer": "과거 수익률은 미래 수익을 보장하지 않습니다. 투자 자문이 아닙니다.",
        "benchmark": BENCH,
        "etfs": meta,
        "pricePath": "prices/{code}.json",
        "note": "시세는 선택 종목 + 벤치마크만 로드하세요. 전체 번들은 etf_prices.json.",
    }

    if args.merge and (META_OUT.exists() or BUNDLE_OUT.exists()):
        prior = {}
        if META_OUT.exists():
            prior = json.loads(META_OUT.read_text(encoding="utf-8"))
        elif BUNDLE_OUT.exists():
            prior = json.loads(BUNDLE_OUT.read_text(encoding="utf-8"))
        by_code = {e["code"]: e for e in prior.get("etfs", []) if isinstance(e, dict) and "code" in e}
        for e in meta:
            by_code[e["code"]] = e
        # Keep stable-ish order: prior order then new
        ordered = []
        seen = set()
        for e in prior.get("etfs", []):
            c = e.get("code")
            if c in by_code and c not in seen:
                ordered.append(by_code[c])
                seen.add(c)
        for e in meta:
            if e["code"] not in seen:
                ordered.append(e)
                seen.add(e["code"])
        meta_payload["etfs"] = ordered
        meta_payload["note"] = prior.get("note", meta_payload["note"])
        if "experimentNote" in prior:
            meta_payload["experimentNote"] = prior["experimentNote"]
        meta_payload["ingestNote"] = (
            f"merged extend start={args.start} codes="
            + ",".join(sorted(prices.keys()))
        )

    META_OUT.write_text(json.dumps(meta_payload, ensure_ascii=False), encoding="utf-8")

    if prices:
        existing_prices = {}
        if args.merge and BUNDLE_OUT.exists():
            old_bundle = json.loads(BUNDLE_OUT.read_text(encoding="utf-8"))
            existing_prices = old_bundle.get("prices", {}) or {}
            # Prefer longer / earlier history from disk per-file if present
            for code, rows in list(existing_prices.items()):
                pf = PRICES_DIR / f"{code}.json"
                if pf.exists():
                    disk = json.loads(pf.read_text(encoding="utf-8"))
                    if disk and (not rows or disk[0]["d"] < rows[0]["d"] or len(disk) > len(rows)):
                        existing_prices[code] = disk
            existing_prices.update(prices)
            prices = existing_prices
        bundle = {
            **meta_payload,
            "prices": prices,
        }
        BUNDLE_OUT.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")
        print("saved", BUNDLE_OUT, "etfs", len(meta_payload["etfs"]), "price_keys", len(prices),
              "bytes", BUNDLE_OUT.stat().st_size)
    print("saved", META_OUT, "etfs", len(meta_payload["etfs"]),
          "price_files", len(list(PRICES_DIR.glob('*.json'))))


if __name__ == "__main__":
    main()
