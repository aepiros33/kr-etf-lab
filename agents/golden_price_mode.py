#!/usr/bin/env python3
"""Byte-identical guard for the price-return (dividend-off) engines.

Hashes the FULL backtest output of every PRESET (lump 1 / DCA 10M+500k, Q, max period)
for app.js (node) and build_backtest.py. `--write REF` stores hashes computed from the
engines at git ref REF (e.g. main before a feature) together with a fingerprint of the
price data used; reviewer compares current engines against it (skips if data changed).
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GOLDEN = HERE / "golden" / "price_mode_golden.json"
sys.path.insert(0, str(HERE))
import build_backtest as bb  # noqa: E402
import parity_check as pc  # noqa: E402


def _preset_weights(app_js: Path) -> dict:
    env = dict(os.environ, APP_JS=str(app_js))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"presets": True}, f)
        p = f.name
    r = subprocess.run(["node", str(HERE / "js_parity.mjs"), p], capture_output=True, text=True, env=env, timeout=300)
    Path(p).unlink(missing_ok=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-1500:])
    return json.loads(r.stdout)["presets"]["PRESETS"]


def fingerprint(prices: dict) -> str:
    h = hashlib.sha256()
    for c in sorted(prices):
        h.update(c.encode())
        h.update(json.dumps(sorted(prices[c].items()), separators=(",", ":")).encode())
    return h.hexdigest()


def js_hashes(app_js: Path, prices: dict) -> dict:
    env = dict(os.environ, APP_JS=str(app_js))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"prices": prices, "presetGolden": True}, f)
        p = f.name
    r = subprocess.run(["node", str(HERE / "js_parity.mjs"), p], capture_output=True, text=True, env=env, timeout=600)
    Path(p).unlink(missing_ok=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-1500:])
    return json.loads(r.stdout)["golden"]


def _norm(x):
    # Python engine sums over set() unions → last-bit float noise depends on PYTHONHASHSEED;
    # normalise to 12 significant digits (JS side is hashed raw, fully deterministic).
    if isinstance(x, float):
        return float(f"{x:.12g}")
    if isinstance(x, dict):
        return {k: _norm(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_norm(v) for v in x]
    return x


def py_hashes(mod, prices: dict, preset_w: dict) -> dict:
    out = {}
    for k, w in preset_w.items():
        w = {c: v for c, v in w.items() if c in prices}
        for tag, ini, mon in (("lump", 1.0, 0.0), ("dca", 10_000_000.0, 500_000.0)):
            s = mod.backtest(w, prices, "2000-01-01", "2099-12-31", "Q", ini, mon, etf_flags={})
            out[f"{k}:{tag}"] = hashlib.sha256(json.dumps(_norm(asdict(s)), sort_keys=True, default=str).encode()).hexdigest()
    return out


def preset_weight_map(app_js: Path) -> dict:
    env = dict(os.environ, APP_JS=str(app_js))
    src = app_js.read_text(encoding="utf-8")
    del src
    # weights come from node (PRESETS object)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"presetWeights": True}, f)
        p = f.name
    r = subprocess.run(["node", str(HERE / "js_parity.mjs"), p], capture_output=True, text=True, env=env, timeout=300)
    Path(p).unlink(missing_ok=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-1500:])
    return json.loads(r.stdout)["presetWeights"]


def current(prices=None) -> dict:
    if prices is None:
        _, prices = bb.load()
    app = ROOT / "app.js"
    pw = preset_weight_map(app)
    return {"fingerprint": fingerprint(prices), "js": js_hashes(app, prices), "py": py_hashes(bb, prices, pw)}


def at_ref(ref: str) -> dict:
    _, prices = bb.load()
    tmp = Path(tempfile.mkdtemp())
    app = tmp / "app.js"
    app.write_text(subprocess.check_output(["git", "show", f"{ref}:app.js"], cwd=ROOT, text=True), encoding="utf-8")
    pyf = tmp / "build_backtest_ref.py"
    pyf.write_text(subprocess.check_output(["git", "show", f"{ref}:agents/build_backtest.py"], cwd=ROOT, text=True), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("build_backtest_ref", pyf)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["build_backtest_ref"] = mod
    spec.loader.exec_module(mod)
    pw = preset_weight_map(app)
    return {"ref": ref, "commit": subprocess.check_output(["git", "rev-parse", ref], cwd=ROOT, text=True).strip(),
            "fingerprint": fingerprint(prices), "js": js_hashes(app, prices), "py": py_hashes(mod, prices, pw)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", metavar="REF")
    a = ap.parse_args()
    if a.write:
        g = at_ref(a.write)
        GOLDEN.write_text(json.dumps(g, indent=1, ensure_ascii=False))
        print("wrote", GOLDEN, len(g["js"]), "js hashes", len(g["py"]), "py hashes")
    else:
        g = json.loads(GOLDEN.read_text())
        c = current()
        print("fingerprint match:", g["fingerprint"] == c["fingerprint"])
        print("js identical:", g["js"] == c["js"], "py identical:", g["py"] == c["py"])
