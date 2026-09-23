#!/usr/bin/env python3
"""One-shot / reusable Yahoo Finance backfill for KRX ETF closes.

Merges earliest available real ETF auto_adjust Close from yfinance `{code}.KS`
into existing FDR/NAVER series:
  - keep existing FDR rows for overlapping dates (authoritative)
  - prepend YF-only dates before first FDR date
  - scale YF pre-history so level matches FDR at the splice (no invented gaps)
  - update etf_meta start/end/n and per-file data/prices/{code}.json

Does not fabricate index proxies. Does not delete short-history ETFs.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
META_OUT = DATA / "etf_meta.json"
PRICES_DIR = DATA / "prices"
BUNDLE_OUT = DATA / "etf_prices.json"

# Long-history codes to extend at least this far when Yahoo has data.
DEFAULT_CODES = [
    "069500",
    "133690",
    "148070",
    "114260",
    "153130",
    "130730",
    "132030",
    "139320",
    "114800",
    "214980",
]


def rows_to_map(rows: list[dict]) -> dict[str, float]:
    return {r["d"]: float(r["c"]) for r in rows if r.get("d") and r.get("c") is not None}


def map_to_rows(m: dict[str, float]) -> list[dict]:
    return [{"d": d, "c": m[d]} for d in sorted(m.keys())]


def fetch_yf(code: str, start: str, retries: int = 5) -> dict[str, float]:
    ticker = f"{code}.KS"
    last_err = None
    for attempt in range(retries):
        try:
            h = yf.Ticker(ticker).history(start=start, auto_adjust=True)
            if h is None or h.empty:
                return {}
            out: dict[str, float] = {}
            for dt, row in h.iterrows():
                c = row.get("Close")
                if c is None:
                    continue
                try:
                    cf = float(c)
                except (TypeError, ValueError):
                    continue
                if cf != cf or cf <= 0:  # NaN / non-positive
                    continue
                out[str(dt.date())] = cf
            return out
        except Exception as e:
            last_err = e
            wait = min(60.0, 2.0 ** attempt)
            print(f"  retry {code} attempt={attempt+1} wait={wait:.1f}s err={e}")
            time.sleep(wait)
    print(f"  FAIL {code}: {last_err}")
    return {}


def splice(existing: dict[str, float], yf_map: dict[str, float]) -> tuple[dict[str, float], dict]:
    """Prefer existing; fill earlier dates from YF; scale YF pre-block to FDR join."""
    info = {
        "existing_n": len(existing),
        "yf_n": len(yf_map),
        "prepended": 0,
        "scaled": False,
        "scale": 1.0,
        "fdr_start": None,
        "new_start": None,
    }
    if not existing:
        merged = dict(yf_map)
        info["prepended"] = len(merged)
        info["new_start"] = min(merged) if merged else None
        return merged, info
    if not yf_map:
        info["fdr_start"] = min(existing)
        info["new_start"] = info["fdr_start"]
        return dict(existing), info

    fdr_start = min(existing)
    info["fdr_start"] = fdr_start
    pre_dates = [d for d in yf_map if d < fdr_start]
    if not pre_dates:
        info["new_start"] = fdr_start
        return dict(existing), info

    # Scale using YF close on FDR start if present, else last YF before FDR start.
    if fdr_start in yf_map and yf_map[fdr_start] > 0:
        scale = existing[fdr_start] / yf_map[fdr_start]
    else:
        join_yf_d = max(pre_dates)
        if yf_map[join_yf_d] <= 0:
            scale = 1.0
        else:
            scale = existing[fdr_start] / yf_map[join_yf_d]
    info["scaled"] = abs(scale - 1.0) > 1e-9
    info["scale"] = scale

    merged = dict(existing)
    for d in pre_dates:
        merged[d] = yf_map[d] * scale
    info["prepended"] = len(pre_dates)
    info["new_start"] = min(merged)
    return merged, info


def update_meta_entry(etfs: list[dict], code: str, rows: list[dict]) -> None:
    for e in etfs:
        if e.get("code") == code:
            if rows:
                e["start"] = rows[0]["d"]
                e["end"] = rows[-1]["d"]
                e["n"] = len(rows)
                e["price"] = rows[-1]["c"]
            return


def main():
    ap = argparse.ArgumentParser(description="Yahoo Finance backfill for KRX ETF prices")
    ap.add_argument("--codes", default=",".join(DEFAULT_CODES))
    ap.add_argument("--start", default="2007-01-01")
    ap.add_argument("--sleep", type=float, default=1.5, help="pause between tickers")
    args = ap.parse_args()

    codes = [c.strip().zfill(6) for c in args.codes.split(",") if c.strip()]
    if not BUNDLE_OUT.exists():
        raise SystemExit(f"missing {BUNDLE_OUT}")

    bundle = json.loads(BUNDLE_OUT.read_text(encoding="utf-8"))
    prices = bundle.get("prices") or {}
    etfs = bundle.get("etfs") or []
    report = []

    PRICES_DIR.mkdir(parents=True, exist_ok=True)

    for code in codes:
        print(f"YF {code} …")
        existing_rows = prices.get(code) or []
        if not existing_rows:
            pf = PRICES_DIR / f"{code}.json"
            if pf.exists():
                existing_rows = json.loads(pf.read_text(encoding="utf-8"))
        existing = rows_to_map(existing_rows)
        yf_map = fetch_yf(code, args.start)
        merged, info = splice(existing, yf_map)
        rows = map_to_rows(merged)
        prices[code] = rows
        (PRICES_DIR / f"{code}.json").write_text(
            json.dumps(rows, ensure_ascii=False), encoding="utf-8"
        )
        update_meta_entry(etfs, code, rows)
        rec = {"code": code, **info, "final_n": len(rows), "final_end": rows[-1]["d"] if rows else None}
        report.append(rec)
        print(
            f"  OK {code} fdr_start={info['fdr_start']} → {info['new_start']} "
            f"+{info['prepended']} scale={info['scale']:.6f} n={len(rows)}"
        )
        time.sleep(args.sleep)

    now = datetime.now().isoformat(timespec="seconds")
    bundle["generatedAt"] = now
    bundle["etfs"] = etfs
    bundle["prices"] = prices
    bundle["source"] = "FinanceDataReader (KRX/NAVER) + Yahoo Finance backfill (pre-FDR)"
    prev_note = bundle.get("ingestNote") or ""
    bundle["ingestNote"] = (
        f"yf_backfill start={args.start} codes={','.join(codes)}; prior={prev_note}"
    )
    BUNDLE_OUT.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")

    if META_OUT.exists():
        meta = json.loads(META_OUT.read_text(encoding="utf-8"))
    else:
        meta = {k: bundle[k] for k in bundle if k != "prices"}
    meta["generatedAt"] = now
    meta["etfs"] = etfs
    meta["source"] = bundle["source"]
    meta["ingestNote"] = bundle["ingestNote"]
    META_OUT.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    print("saved", BUNDLE_OUT, "keys", len(prices), "bytes", BUNDLE_OUT.stat().st_size)
    print("saved", META_OUT)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
