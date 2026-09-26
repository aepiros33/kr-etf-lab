// JS engine runner for reviewer parity checks (node, no DOM).
// usage: node agents/js_parity.mjs <job.json>  → prints JSON results to stdout
// job: {"prices": {code:{d:c}}, "backtest": [{weights,start,end,rebalance,initial,monthly,opts}],
//       "dividend": [{weights,start,end,rebalance,initial,monthly,opts}], "divData": {...}}
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const noop = () => {};
const el = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : el),
  apply: () => el,
  set: () => true,
});
const document = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => el, body: el, documentElement: el };
const ctx = { console, document, window: {}, location: { hash: "", search: "", href: "" }, history: { replaceState: noop }, navigator: {}, localStorage: { getItem: () => null, setItem: noop }, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, URLSearchParams, Chart: function () {}, matchMedia: () => ({ matches: false, addEventListener: noop }) };
ctx.window = ctx;
vm.createContext(ctx);
const appPath = process.env.APP_JS || path.join(root, "app.js");
const src = fs.readFileSync(appPath, "utf8") + "\n;globalThis.__x={state,PRESETS,DIV_PRESETS:typeof DIV_PRESETS!=='undefined'?DIV_PRESETS:null};";
vm.runInContext(src, ctx, { filename: "app.js" });

const out = { backtest: [], dividend: [] };
if (job.presetGolden) {
  // full-output hashes of every PRESET (lump + DCA) for the byte-identical check
  const crypto = await import("node:crypto");
  out.golden = {};
  for (const [k, p] of Object.entries(ctx.__x.PRESETS)) {
    const w = Object.fromEntries(Object.entries(p.w || {}).filter(([c]) => job.prices[c]));
    for (const [tag, ini, mon] of [["lump", 1, 0], ["dca", 10000000, 500000]]) {
      const r = ctx.backtest(w, job.prices, "2000-01-01", "2099-12-31", p.rebalance || "Q", ini, mon, { etfFlags: {} });
      out.golden[`${k}:${tag}`] = crypto.createHash("sha256").update(JSON.stringify(r)).digest("hex");
    }
  }
}
for (const c of job.backtest || []) {
  const r = ctx.backtest(c.weights, job.prices, c.start, c.end, c.rebalance, c.initial, c.monthly, { etfFlags: {}, ...(c.opts || {}) });
  out.backtest.push(r.error ? { error: r.error } : {
    start: r.start, end: r.end, finalValue: r.finalValue, totalInvested: r.totalInvested, totalRet: r.totalRet,
    cagr: r.cagr, mdd: r.mdd, vol: r.vol, sharpe: r.sharpe, n: (r.curve || []).length,
    curveTail: (r.curve || []).slice(-1)[0], rebalCount: r.rebalCount, costDrag: r.totalCostDrag,
  });
}
for (const c of job.dividend || []) {
  const r = ctx.backtestDividend(c.weights, job.divData, c.start, c.end, c.rebalance, c.initial, c.monthly, c.opts || {});
  if (r.error) { out.dividend.push({ error: r.error }); continue; }
  delete r.curve;
  delete r.dividends.events;
  out.dividend.push(r);
}
// dividend share-hash round trip: encode(state) → decode(hash)
if (job.divShare) {
  out.divShare = job.divShare.map((st) => {
    const h = ctx.divEncodeHash(st);
    return { hash: h, back: ctx.divDecodeHash("#" + h) };
  });
}
if (job.divLegacy) out.divLegacy = job.divLegacy.map((h) => ctx.divDecodeHash(h));
// dividend CSV text for given cases (same builder the UI download uses)
if (job.divCsv) {
  out.divCsv = job.divCsv.map((c) => {
    const r = ctx.backtestDividend(c.weights, job.divData, c.start, c.end, c.rebalance, c.initial, c.monthly, c.opts || {});
    if (r.error) return { error: r.error };
    return { csv: ctx.divBuildCsv({ compare: false, r, ctl: { period: "custom" } }, { etfs: job.divEtfs || [], generated: "test" }) };
  });
}
if (job.presetWeights) out.presetWeights = Object.fromEntries(Object.entries(ctx.__x.PRESETS).map(([k, p]) => [k, p.w || {}]));
if (job.presets) out.presets = { PRESETS: Object.keys(ctx.__x.PRESETS), DIV_PRESETS: ctx.__x.DIV_PRESETS };
process.stdout.write(JSON.stringify(out));
