/** Exported for reviewer parity docs; weights must sum to 100.
 * longProxy: remapped to longer-history tickers (10y+). Do not invent new holdings — label only.
 * Common remaps: 360750→133690, cash/KOFR→153130, gold spot→132030, income/semi→broad proxies.
 */
const PRESET_PROXY_TIP =
  "10년+용 장기 대용 — 원 의도(단기 상장 ETF)와 보유 구성이 다름. 과거 시뮬용 프록시.";
const PRESETS = {
  kAllWeather: {
    label: "🛡️ K-올웨더",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: S&P·US채권·금현물·KOFR → 나스닥100·국고채·금선물·단기채)",
    w: {
      "069500": 15,
      "133690": 17.5,
      "148070": 17.5,
      "114260": 15,
      "132030": 15,
      "153130": 20,
    },
  },
  permanent: {
    label: "🏛️ 영구 포트폴리오",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: S&P·US채권·금현물·KOFR → 나스닥100·국고채3년·금선물·단기채)",
    w: {
      "069500": 12.5,
      "133690": 12.5,
      "148070": 12.5,
      "114260": 12.5,
      "132030": 25,
      "153130": 25,
    },
  },
  global6040: {
    label: "📈 글로벌 60/40",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: 360750·453850 → 133690·148070)",
    w: {
      "133690": 40,
      "069500": 20,
      "148070": 40,
    },
  },
  monthlyIncome: {
    label: "💵 월배당 인컴형",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (월배당 테마 대신 한미주식·국고채·단기채 장기 대용)",
    w: {
      "133690": 30,
      "069500": 20,
      "148070": 30,
      "153130": 20,
    },
  },
  goldenButterfly: {
    label: "🦋 골든버터플라이",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: 코스닥·금현물 → 나스닥100·금선물)",
    w: {
      "069500": 20,
      "133690": 20,
      "148070": 20,
      "153130": 20,
      "132030": 20,
    },
  },
  growth80: {
    label: "🚀 성장 80/20",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: S&P 비중을 나스닥100 장기로 통합)",
    w: {
      "133690": 60,
      "069500": 20,
      "148070": 20,
    },
  },
  koreaUs: {
    label: "🇰🇷🇺🇸 한미 분산",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (예: 코스닥·S&P → 코스피200·나스닥100)",
    w: {
      "069500": 35,
      "133690": 30,
      "148070": 20,
      "153130": 15,
    },
  },
  divGrowth: {
    label: "📈 배당성장",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (배당성장 테마 대신 코스피·나스닥·국고채·단기채)",
    w: {
      "069500": 50,
      "133690": 20,
      "148070": 15,
      "153130": 15,
    },
  },
  semiDefensive: {
    label: "🛡️ 반도체+방어",
    longProxy: true,
    proxyTip: PRESET_PROXY_TIP + " (반도체 테마·금현물 → 코스피200·금선물·국고채·단기채)",
    w: {
      "069500": 40,
      "148070": 25,
      "132030": 20,
      "153130": 15,
    },
  },
};
const CATS = ["전체", "국내주식", "해외주식", "테마", "채권", "원자재", "현금성"];
const BENCH = "069500";
const SAFER_CATS = new Set(["채권", "현금성", "원자재"]);
/** Name patterns treated as safer for IRP 참고 check (meta category may mis-tag US bonds). */
const SAFER_NAME_RE = /국채|채권|KOFR|CD금리|단기채권/;
const INCOME_YIELD = {
  "458730": 0.035,
  "329200": 0.04,
  "441640": 0.05,
  "472150": 0.045,
};
const CAT_YIELD = {
  국내주식: 0.018,
  해외주식: 0.012,
  채권: 0.025,
  현금성: 0.03,
  원자재: 0,
  테마: 0.02,
};

const ROLLING_WINDOWS = { "1y": 252, "3y": 756, "5y": 1260, "10y": 2520 };

/** Batch 6: start-date sensitivity (mirror agents/build_backtest). */
const SENSITIVITY_MAX_STARTS = 120;
const SENSITIVITY_MIN_DAYS = 20;
const SENSITIVITY_CHUNK = 8;

const state = {
  meta: null,
  prices: {},
  selected: {},
  period: "max",
  rebalance: "Q",
  momLookback: 1,
  momTopN: 3,
  weighting: "fixed",
  volWindow: 60,
  maOverlay: false,
  maWindow: 200,
  maSignalFreq: "monthly", // monthly (month-start signal, default) | rebal (legacy: rebalance dates only)
  cashCode: "153130",
  maCashPct: 1.0,
  regimeHedge: false,
  regimeHedgeMode: "inverse", // inverse (−1x 114800) | cash (153130/423160)
  regimeHedgePct: 0.15, // hard cap ≤15%
  regimeHedgeCode: "114800",
  goldOn: false,
  goldSleevePct: 0.15, // UI 10–20%
  goldLookback: 1, // 1|3
  goldCode: "132030", // 411060 spot | 132030 futures long (default long for 10y)
  bandOn: false,
  bandPct: 0.05, // UI 1–10%, default 5%
  /** Vol target overlay: scale risky sleeve to trailing vol ≈ target; residual → cash. */
  volTarget: false,
  volTargetPct: 0.10, // annualized, UI 5–20%
  volTargetWindow: 60,
  /** Sleeve trend: per-category abs mom / MA ON-OFF; OFF → cash. */
  sleeveTrend: false,
  sleeveTrendMode: "abs", // abs | ma
  sleeveTrendLookback: 1, // 1|3 for abs
  /** Trading cost rate (fraction of one-way turnover). Default 0.1% = legacy MOM. */
  tradeCost: 0.001,
  chart: null,
  ddChart: null,
  rollingChart: null,
  rollingWindow: "3y",
  /** Batch 6: start-date sensitivity heatmap */
  sensitivityMetric: "cagr", // cagr | mdd
  sensitivityResult: null,
  sensitivityToken: 0,
  sensitivityRunning: false,
  lastPortCurve: null,
  lastBenchCurve: null,
  search: "",
  category: "전체",
  /** Structure filters (OR when any on): hedged / futures / spot */
  structFilters: { hedged: false, futures: false, spot: false },
  pricesAsOf: null,
  /** Last successful run payload for CSV export / share. */
  lastRun: null,
  /** Preset key if selection still matches that preset; else null. */
  activePreset: null,
  /** Multi-port compare slots (Batch 3). Each: {label,presetKey,picks,cfg,result} or null. */
  compareSlots: { A: null, B: null },
  compareChart: null,
  /** "single" | "compare" */
  viewMode: "single",
  dcaOn: false,
  initialCapital: 10_000_000,
  monthlyAmount: 500_000,
  loadingPrices: false,
  totalReturn: false,
  accountType: "taxable",
  pensionTaxRate: 0.044,
};
const $ = (s) => document.querySelector(s);

/** Derive FX-hedge / futures / spot from name when meta lacks dedicated fields.
 * Rules (name only, no invented prices):
 *  - 환헤지(H): includes "환헤지" or "(H)" / "（H）"
 *  - 선물: includes "선물"
 *  - 현물: includes "현물" (spot/physical)
 */
function etfStructureFlags(etf) {
  const n = etf.name || "";
  return {
    hedged: /환헤지|\(H\)|（H）/.test(n),
    futures: n.includes("선물"),
    spot: n.includes("현물"),
  };
}

/** Max trading date from etf_prices bundle (or meta etf.end / as_of). */
function resolvePricesAsOf(meta, bundle) {
  if (bundle && bundle.as_of) return String(bundle.as_of).slice(0, 10);
  if (meta && meta.as_of) return String(meta.as_of).slice(0, 10);
  let mx = null;
  const consider = (d) => {
    if (d && (!mx || d > mx)) mx = d;
  };
  if (meta && Array.isArray(meta.etfs)) {
    for (const e of meta.etfs) consider(e.end);
  }
  if (bundle && bundle.prices) {
    for (const rows of Object.values(bundle.prices)) {
      if (rows && rows.length) consider(rows[rows.length - 1].d);
    }
  }
  return mx;
}

function structureBadgeHtml(flags) {
  const bits = [];
  if (flags.hedged)
    bits.push('<span class="etf-badge hedged" title="환헤지(H)">환헤지(H)</span>');
  if (flags.futures)
    bits.push('<span class="etf-badge futures" title="선물 기반">선물</span>');
  if (flags.spot)
    bits.push('<span class="etf-badge spot" title="현물/실물">현물</span>');
  return bits.length ? `<span class="etf-badges">${bits.join("")}</span>` : "";
}



/** First available close date for a code: price keys, else meta.start. */
function firstAvailableDate(code) {
  const series = state.prices[code];
  if (series && typeof series === "object") {
    const keys = Object.keys(series);
    if (keys.length) return keys.reduce((a, b) => (a < b ? a : b));
  }
  const etf = etfByCode(code);
  return etf && etf.start ? etf.start : null;
}

/**
 * Compare requested period vs actual common window; list tickers that truncated
 * (listing/price start later than requested start) or had no usable series.
 */
function buildWindowInfo(result, picks, requestedStart, requestedEnd) {
  const rows = [];
  const seen = new Set();
  const extras = [];
  if (state.rebalance === "DMOM" || state.maOverlay || (state.regimeHedge && state.regimeHedgeMode === "cash")) {
    extras.push(state.cashCode || "153130");
  }
  if (state.regimeHedge) {
    extras.push(REGIME_HEDGE_B);
    if (state.regimeHedgeMode === "inverse") extras.push(state.regimeHedgeCode || "114800");
  }
  if (state.goldOn) {
    extras.push(resolveGoldCode(state.goldCode), GOLD_CASH);
  }
  const allCodes = [
    ...picks.map(([c]) => c),
    ...extras.filter((c) => c && !picks.some(([pc]) => pc === c)),
  ];
  for (const code of allCodes) {
    if (seen.has(code)) continue;
    seen.add(code);
    const etf = etfByCode(code);
    const listingStart = (etf && etf.start) || null;
    const priceStart = firstAvailableDate(code);
    const first = priceStart || listingStart;
    const isPick = picks.some(([pc]) => pc === code);
    let status = "ok";
    if (!state.prices[code] || !Object.keys(state.prices[code] || {}).length) {
      status = "excluded";
    } else if (first && requestedStart && first > requestedStart) {
      status = "truncated";
    } else if (first && result && result.start && first === result.start && requestedStart && first > requestedStart) {
      status = "truncated";
    }
    rows.push({
      code,
      name: (etf && etf.name) || code,
      listingStart: listingStart || "?",
      priceStart: priceStart || "?",
      first: first || "?",
      status,
      role: isPick ? "hold" : "overlay",
    });
  }
  const truncated = rows.filter((r) => r.status === "truncated");
  const excluded = rows.filter((r) => r.status === "excluded");
  return {
    requestedStart: requestedStart || "",
    requestedEnd: requestedEnd || "",
    actualStart: result && result.start ? result.start : "",
    actualEnd: result && result.end ? result.end : "",
    days: result && result.days != null ? result.days : 0,
    years: result && result.years != null ? result.years : 0,
    rows,
    truncated,
    excluded,
  };
}

function renderWindowCard(info) {
  if (!info || !info.actualStart) return "";
  const truncLines = info.truncated.length
    ? info.truncated
        .map(
          (r) =>
            `<li><code>${r.code}</code> ${r.name}${r.role === "overlay" ? " (전략 보조)" : ""} · 시세시작 ${r.priceStart} (상장 ${r.listingStart}) → 요청 시작(${info.requestedStart || "—"})보다 늦어 공통 기간을 자름</li>`
        )
        .join("")
    : "<li>선택 종목 중 요청 시작일보다 늦게 시작하는 종목 없음</li>";
  const exclLines = info.excluded.length
    ? `<ul class="window-list">${info.excluded
        .map((r) => `<li><code>${r.code}</code> ${r.name} · 시세 없음(제외)</li>`)
        .join("")}</ul>`
    : "";
  const shortened =
    info.requestedStart && info.actualStart && info.actualStart > info.requestedStart
      ? `<div class="warn">요청 시작 ${info.requestedStart}보다 실제 시작이 ${info.actualStart}로 늦습니다. 아래 잘린 종목이 원인입니다.</div>`
      : "";
  return `<div class="card pad window-card" id="windowCard">
    <div class="section-title">공통 기간 · 잘린 종목</div>
    <div class="window-summary">실제 <strong>${info.actualStart}</strong> ~ <strong>${info.actualEnd}</strong>
      · ${Number(info.years).toFixed(1)}년 · ${info.days}거래일
      · 요청 ${info.requestedStart || "—"} ~ ${info.requestedEnd || "—"} (${state.period})</div>
    ${shortened}
    <div class="muted-note" style="margin-top:8px">상장·시세 시작이 요청 기간보다 짧은 ETF가 있으면 포트 공통창이 그 날짜로 맞춰집니다.</div>
    <ul class="window-list">${truncLines}</ul>
    ${exclLines}
  </div>`;
}

function renderExportBar() {
  return `<div class="export-bar btn-row" id="exportBar">
    <button type="button" class="secondary" id="btnExportCsv">결과 CSV</button>
    <button type="button" class="secondary" id="btnCopyShare">설정 링크 복사</button>
    <button type="button" class="secondary" id="btnSaveSlotA">A에 저장</button>
    <button type="button" class="secondary" id="btnSaveSlotB">B에 저장</button>
  </div>
  <p class="muted-note" id="shareUrlNote">공유 URL은 해시(#)에 프리셋 또는 코드·비중, 기간, 리밸런싱·오버레이 플래그를 넣습니다. 상세는 docs/SHARE_URL.md. 투자 자문 아님.</p>
  <p class="muted-note">실행 결과를 슬롯 A/B에 저장한 뒤 「비교 보기」로 나란히 볼 수 있습니다.</p>`;
}

/** Compact share state → location.hash (v=1). Prefer preset id when selection matches. */
function encodeShareParams() {
  const p = new URLSearchParams();
  p.set("v", "1");
  const preset = state.activePreset;
  const matchesPreset =
    preset &&
    PRESETS[preset] &&
    (() => {
      const w = PRESETS[preset].w;
      const sel = state.selected;
      const keys = Object.keys(w);
      if (keys.length !== Object.keys(sel).filter((c) => sel[c] > 0).length) return false;
      return keys.every((c) => Math.abs((sel[c] || 0) - w[c]) < 1e-6);
    })();
  if (matchesPreset) {
    p.set("preset", preset);
  } else {
    const parts = Object.entries(state.selected)
      .filter(([, w]) => w > 0)
      .map(([c, w]) => `${c}*${Number(w)}`)
      .join("_");
    if (parts) p.set("h", parts);
  }
  p.set("p", state.period || "max");
  if (state.period === "custom") {
    const s = $("#startDate") && $("#startDate").value;
    const e = $("#endDate") && $("#endDate").value;
    if (s) p.set("ps", s);
    if (e) p.set("pe", e);
  }
  p.set("rb", state.rebalance || "Q");
  if (
    state.rebalance === "MOM" ||
    state.rebalance === "DMOM" ||
    state.rebalance === "MOM12_1" ||
    state.rebalance === "XSMOM"
  ) {
    p.set("lb", String(state.momLookback || 1));
    p.set("tn", String(state.momTopN || 3));
  }
  if (state.weighting === "invVol") p.set("w", "invVol");
  if (state.maOverlay) {
    p.set("ma", "1");
    p.set("mw", String(state.maWindow || 200));
    if (normMaSignalFreq(state.maSignalFreq) === "rebal") p.set("maf", "rebal");
  }
  if (
    state.rebalance === "DMOM" ||
    state.maOverlay ||
    (state.regimeHedge && state.regimeHedgeMode === "cash") ||
    state.volTarget ||
    state.sleeveTrend
  ) {
    p.set("cash", state.cashCode || "153130");
  }
  if (state.volTarget) {
    p.set("vt", "1");
    p.set("vtp", String(Math.round((Number(state.volTargetPct) || 0.1) * 100)));
    p.set("vtw", String(state.volTargetWindow || 60));
  }
  if (state.sleeveTrend) {
    p.set("st", "1");
    p.set("stm", state.sleeveTrendMode === "ma" ? "ma" : "abs");
    p.set("stlb", String(state.sleeveTrendLookback || 1));
  }
  if (state.regimeHedge) {
    p.set("rh", "1");
    p.set("rhm", state.regimeHedgeMode === "cash" ? "cash" : "inverse");
    p.set("rhp", String(Math.round(Math.min(0.15, state.regimeHedgePct || 0.15) * 100)));
  }
  if (state.goldOn) {
    p.set("gold", "1");
    p.set("gsp", String(Math.round(clampGoldSleeve(state.goldSleevePct) * 100)));
    p.set("glb", String(state.goldLookback || 1));
    p.set("gc", resolveGoldCode(state.goldCode));
  }
  if (state.bandOn) {
    p.set("band", "1");
    p.set("bp", String(Math.round(clampBandPct(state.bandPct) * 100)));
  }
  {
    const bps = Math.round(clampTradeCost(state.tradeCost) * 10000);
    if (bps !== Math.round(TRADE_COST_DEFAULT * 10000)) p.set("tc", String(bps));
  }
  if (state.dcaOn) {
    p.set("dca", "1");
    p.set("ic", String(state.initialCapital || 10000000));
    p.set("mo", String(state.monthlyAmount || 0));
  }
  if (state.totalReturn && hasRealTrData()) p.set("tr", "1");
  if (state.accountType === "pension") {
    p.set("acct", "pension");
    p.set("ptr", String(state.pensionTaxRate || 0.044));
  }
  return p.toString();
}

function buildShareUrl() {
  const q = encodeShareParams();
  const base = `${location.origin}${location.pathname}${location.search}`;
  return `${base}#${q}`;
}

async function copyShareUrl() {
  const url = buildShareUrl();
  try {
    history.replaceState(null, "", `#${encodeShareParams()}`);
  } catch (_) {
    /* ignore */
  }
  try {
    await navigator.clipboard.writeText(url);
    const note = $("#shareUrlNote");
    if (note) {
      note.textContent = `링크 복사됨 (${url.length}자). 해시 키: preset|h, p, rb, w, ma, rh, gold, dca, tr 등 · docs/SHARE_URL.md`;
    }
  } catch (_) {
    prompt("설정 링크를 복사하세요", url);
  }
}

function parseShareHash() {
  const raw = (location.hash || "").replace(/^#/, "").trim();
  if (!raw || !raw.includes("=")) return null;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch (_) {
    return null;
  }
  if (params.get("v") !== "1" && !params.get("preset") && !params.get("h")) return null;
  return params;
}

function syncControlsFromState() {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el != null && v != null) el.value = v;
  };
  const setChk = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!on;
  };
  setVal("period", state.period);
  const custom = $("#customDates");
  if (custom) custom.style.display = state.period === "custom" ? "flex" : "none";
  setVal("rebalance", state.rebalance);
  setVal("momLookback", String(state.momLookback));
  setVal("momTopN", String(state.momTopN));
  setVal("weighting", state.weighting);
  setChk("maOverlay", state.maOverlay);
  setVal("maWindow", String(state.maWindow));
  setVal("maSignalFreq", normMaSignalFreq(state.maSignalFreq));
  syncMaFreqHint();
  setVal("cashCode", state.cashCode);
  setChk("regimeHedge", state.regimeHedge);
  setVal("regimeHedgeMode", state.regimeHedgeMode);
  setVal("regimeHedgePct", String(Math.round(Math.min(0.15, state.regimeHedgePct || 0.15) * 100)));
  setChk("goldOn", state.goldOn);
  setVal("goldSleevePct", String(Math.round(clampGoldSleeve(state.goldSleevePct) * 100)));
  setVal("goldLookback", String(state.goldLookback));
  setVal("goldCode", resolveGoldCode(state.goldCode));
  setChk("bandOn", state.bandOn);
  setVal("bandPct", String(Math.round(clampBandPct(state.bandPct) * 100)));
  const bandRow = $("#bandRow");
  if (bandRow) bandRow.style.display = state.bandOn ? "flex" : "none";
  setChk("volTarget", state.volTarget);
  setVal("volTargetPct", String(Math.round((Number(state.volTargetPct) || 0.1) * 100)));
  setVal("volTargetWindow", String(state.volTargetWindow || 60));
  const vtRow = $("#volTargetRow");
  if (vtRow) vtRow.style.display = state.volTarget ? "flex" : "none";
  const vtHint = $("#volTargetHint");
  if (vtHint) vtHint.style.display = state.volTarget ? "block" : "none";
  setChk("sleeveTrend", state.sleeveTrend);
  setVal("sleeveTrendMode", state.sleeveTrendMode === "ma" ? "ma" : "abs");
  setVal("sleeveTrendLookback", String(state.sleeveTrendLookback || 1));
  const stRow = $("#sleeveTrendRow");
  if (stRow) stRow.style.display = state.sleeveTrend ? "flex" : "none";
  const stHint = $("#sleeveTrendHint");
  if (stHint) stHint.style.display = state.sleeveTrend ? "block" : "none";
  const tcEl = $("#tradeCost");
  if (tcEl) tcEl.value = String(Math.round(clampTradeCost(state.tradeCost) * 10000));
  updateTradeCostLabel();
  setChk("dcaOn", state.dcaOn);
  const dcaIn = $("#dcaInputs");
  if (dcaIn) dcaIn.style.display = state.dcaOn ? "flex" : "none";
  setVal("initialCapital", String(state.initialCapital));
  setVal("monthlyAmount", String(state.monthlyAmount));
  const trWrap = $("#trSection");
  const realTr = hasRealTrData();
  if (trWrap) trWrap.style.display = realTr ? "block" : "none";
  const priceDisc = $("#priceReturnDisclosure");
  if (priceDisc) priceDisc.style.display = realTr ? "none" : "block";
  if (!realTr) state.totalReturn = false;
  setChk("trOn", state.totalReturn);
  if (state.accountType === "pension") {
    const p = $("#acctPension");
    if (p) p.checked = true;
  } else {
    const t = $("#acctTaxable");
    if (t) t.checked = true;
  }
  const ptr = $("#pensionTaxRow");
  if (ptr) ptr.style.display = state.accountType === "pension" ? "flex" : "none";
  setVal("pensionTaxRate", String(state.pensionTaxRate));
}

async function applyShareParams(params) {
  const preset = params.get("preset");
  if (preset && PRESETS[preset]) {
    state.activePreset = preset;
    state.selected = {};
    const codes = Object.keys(PRESETS[preset].w);
    await ensurePrices(codes);
    Object.entries(PRESETS[preset].w).forEach(([code, val]) => {
      if (state.meta.etfs.some((e) => e.code === code)) state.selected[code] = val;
    });
    document.querySelectorAll("#presets .chip").forEach((el) =>
      el.classList.toggle("active", el.dataset.key === preset)
    );
  } else if (params.get("h")) {
    state.activePreset = null;
    state.selected = {};
    document.querySelectorAll("#presets .chip").forEach((el) => el.classList.remove("active"));
    const parts = params.get("h").split("_").filter(Boolean);
    const codes = [];
    for (const part of parts) {
      const [code, wStr] = part.split("*");
      const w = Number(wStr);
      if (code && Number.isFinite(w) && w > 0) {
        state.selected[code] = w;
        codes.push(code);
      }
    }
    await ensurePrices(codes);
  }
  const period = params.get("p");
  if (period && ["1y", "3y", "5y", "10y", "max", "custom"].includes(period)) state.period = period;
  if (state.period === "custom") {
    if (params.get("ps") && $("#startDate")) $("#startDate").value = params.get("ps");
    if (params.get("pe") && $("#endDate")) $("#endDate").value = params.get("pe");
  }
  const rb = params.get("rb");
  if (rb && ["Q", "Y", "M", "MOM", "MOM12_1", "XSMOM", "DMOM", "N"].includes(rb)) state.rebalance = rb;
  if (params.get("lb")) state.momLookback = Number(params.get("lb")) >= 3 ? 3 : 1;
  if (params.get("tn")) state.momTopN = Math.max(1, Math.min(20, Number(params.get("tn")) || 3));
  state.weighting = params.get("w") === "invVol" ? "invVol" : "fixed";
  state.maOverlay = params.get("ma") === "1";
  if (params.get("mw")) state.maWindow = Number(params.get("mw")) === 100 ? 100 : 200;
  state.maSignalFreq = normMaSignalFreq(params.get("maf"));
  if (params.get("cash")) state.cashCode = params.get("cash");
  state.regimeHedge = params.get("rh") === "1";
  if (params.get("rhm")) state.regimeHedgeMode = params.get("rhm") === "cash" ? "cash" : "inverse";
  if (params.get("rhp")) {
    const v = Number(params.get("rhp"));
    state.regimeHedgePct = Math.min(0.15, Math.max(0, Number.isFinite(v) ? v / 100 : 0.15));
  }
  state.goldOn = params.get("gold") === "1";
  if (params.get("gsp")) state.goldSleevePct = clampGoldSleeve(Number(params.get("gsp")) / 100);
  if (params.get("glb")) state.goldLookback = Number(params.get("glb")) >= 3 ? 3 : 1;
  if (params.get("gc")) state.goldCode = resolveGoldCode(params.get("gc"));
  state.bandOn = params.get("band") === "1";
  if (params.get("bp")) {
    const v = Number(params.get("bp"));
    state.bandPct = clampBandPct(Number.isFinite(v) ? v / 100 : BAND_PCT_DEFAULT);
  }
  state.volTarget = params.get("vt") === "1";
  if (params.get("vtp")) {
    const v = Number(params.get("vtp"));
    state.volTargetPct = Math.max(0.01, Math.min(0.5, Number.isFinite(v) ? v / 100 : 0.1));
  }
  if (params.get("vtw")) {
    const v = Number(params.get("vtw"));
    state.volTargetWindow = Math.max(5, Math.min(252, Number.isFinite(v) ? v : 60));
  }
  state.sleeveTrend = params.get("st") === "1";
  if (params.get("stm")) state.sleeveTrendMode = params.get("stm") === "ma" ? "ma" : "abs";
  if (params.get("stlb")) state.sleeveTrendLookback = Number(params.get("stlb")) >= 3 ? 3 : 1;
  if (params.get("tc") != null && params.get("tc") !== "") {
    const bps = Number(params.get("tc"));
    state.tradeCost = clampTradeCost(Number.isFinite(bps) ? bps / 10000 : TRADE_COST_DEFAULT);
  }
  state.dcaOn = params.get("dca") === "1";
  if (params.get("ic")) state.initialCapital = Math.max(1, Number(params.get("ic")) || 1);
  if (params.get("mo")) state.monthlyAmount = Math.max(0, Number(params.get("mo")) || 0);
  state.totalReturn = params.get("tr") === "1" && hasRealTrData();
  if (params.get("acct") === "pension") {
    state.accountType = "pension";
    if (params.get("ptr")) state.pensionTaxRate = Number(params.get("ptr")) || 0.044;
  } else {
    state.accountType = "taxable";
  }
  syncControlsFromState();
  renderList();
  updateSum();
  updateIrpWarn();
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

function exportRunCsv() {
  const pack = state.lastRun;
  if (!pack || !pack.result || pack.result.error) {
    alert("먼저 백테스트를 실행하세요.");
    return;
  }
  const { result: r, picks, bench, windowInfo } = pack;
  const lines = [];
  lines.push("section,key,value");
  lines.push(["meta", "generated", new Date().toISOString().slice(0, 19)].map(csvEscape).join(","));
  lines.push(["meta", "pricesAsOf", state.pricesAsOf || ""].map(csvEscape).join(","));
  lines.push(["meta", "note", "시뮬레이터 결과 내보내기 · 투자 자문 아님"].map(csvEscape).join(","));
  lines.push(["meta", "returnBasis", "수정주가 기준(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬"].map(csvEscape).join(","));
  lines.push(["meta", "costFormula", "리밸런싱 시 value -= value×TO×rate; TO=0.5×Σ|Δw|"].map(csvEscape).join(","));
  lines.push("");
  lines.push("section,code,name,weight_pct");
  for (const [code, w] of picks) {
    const etf = etfByCode(code);
    lines.push(["holdings", code, (etf && etf.name) || "", w].map(csvEscape).join(","));
  }
  lines.push("");
  lines.push("section,param,value");
  const params = [
    ["period", state.period],
    ["rebalance", state.rebalance],
    ["weighting", state.weighting],
    ["momLookback", state.momLookback],
    ["momTopN", state.momTopN],
    ["maOverlay", state.maOverlay],
    ["maWindow", state.maWindow],
    ["maSignalFreq", normMaSignalFreq(state.maSignalFreq)],
    ["cashCode", state.cashCode],
    ["regimeHedge", state.regimeHedge],
    ["regimeHedgeMode", state.regimeHedgeMode],
    ["regimeHedgePct", state.regimeHedgePct],
    ["goldOn", state.goldOn],
    ["goldSleevePct", clampGoldSleeve(state.goldSleevePct)],
    ["goldLookback", state.goldLookback],
    ["goldCode", resolveGoldCode(state.goldCode)],
    ["bandOn", state.bandOn],
    ["bandPct", clampBandPct(state.bandPct)],
    ["tradeCost", clampTradeCost(state.tradeCost)],
    ["tradeCostBps", Math.round(clampTradeCost(state.tradeCost) * 10000)],
    ["dcaOn", state.dcaOn],
    ["initialCapital", state.initialCapital],
    ["monthlyAmount", state.monthlyAmount],
    ["totalReturn", state.totalReturn],
    ["accountType", state.accountType],
    ["activePreset", state.activePreset || ""],
    ["commonStart", r.start],
    ["commonEnd", r.end],
    ["years", r.years],
    ["days", r.days],
  ];
  for (const [k, v] of params) {
    lines.push(["params", k, v].map(csvEscape).join(","));
  }
  lines.push("");
  lines.push("section,metric,value");
  const kpis = [
    ["cagr", r.cagr],
    ["totalRet", r.totalRet],
    ["mdd", r.mdd],
    ["vol", r.vol],
    ["sharpe", r.sharpe],
    ["totalInvested", r.totalInvested],
    ["finalValue", r.finalValue],
    ["rebalCount", r.rebalCount != null ? r.rebalCount : ""],
    ["sleeveUpdateCount", r.sleeveUpdateCount != null ? r.sleeveUpdateCount : ""],
    ["maSwitchCount", r.maSignalFreq ? r.maSwitchCount : ""],
    ["dcaBuyCount", r.dcaBuyCount != null ? r.dcaBuyCount : ""],
    ["bandApplied", !!r.bandApplied],
    ["tradeCost", r.tradeCost != null ? r.tradeCost : ""],
    ["totalCostDrag", r.totalCostDrag != null ? r.totalCostDrag : ""],
  ];
  for (const [k, v] of kpis) {
    lines.push(["kpi", k, v].map(csvEscape).join(","));
  }
  if (r.yearly && Object.keys(r.yearly).length) {
    lines.push("");
    lines.push("section,year,portfolio,benchmark");
    for (const y of Object.keys(r.yearly).sort()) {
      const b = bench && bench.yearly ? bench.yearly[y] : "";
      lines.push(["yearly", y, r.yearly[y], b === undefined ? "" : b].map(csvEscape).join(","));
    }
  }
  if (windowInfo && windowInfo.rows && windowInfo.rows.length) {
    lines.push("");
    lines.push("section,code,listingStart,priceStart,status");
    for (const row of windowInfo.rows) {
      lines.push(["window", row.code, row.listingStart, row.priceStart, row.status].map(csvEscape).join(","));
    }
  }
  const stamp = (r.end || "run").replace(/-/g, "");
  downloadText(`kr-etf-lab_${stamp}.csv`, "\uFEFF" + lines.join("\n"));
}

function wireExportBar() {
  const csvBtn = $("#btnExportCsv");
  if (csvBtn) csvBtn.onclick = () => exportRunCsv();
  const shareBtn = $("#btnCopyShare");
  if (shareBtn) shareBtn.onclick = () => copyShareUrl();
  const aBtn = document.querySelector("#btnSaveSlotA, #btnSlotSaveA");
  if (aBtn) aBtn.onclick = () => saveCurrentToSlot("A");
  const bBtn = document.querySelector("#btnSaveSlotB, #btnSlotSaveB");
  if (bBtn) bBtn.onclick = () => saveCurrentToSlot("B");
}


function pct(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = (n * 100).toFixed(digits);
  return (n > 0 ? "+" : "") + v + "%";
}
function cls(n) {
  if (n == null || Number.isNaN(n)) return "";
  return n >= 0 ? "pos" : "neg";
}

/** Years on the curve lacking Jan (start) or Dec (end) are partial calendar years. */
function partialYearSet(curve) {
  const byY = {};
  for (const p of curve || []) {
    const d = Array.isArray(p) ? p[0] : p.d;
    (byY[d.slice(0, 4)] ||= []).push(d);
  }
  const partial = new Set();
  for (const [y, ds] of Object.entries(byY)) {
    const hasJan = ds.some((d) => d.slice(5, 7) === "01");
    const hasDec = ds.some((d) => d.slice(5, 7) === "12");
    if (!hasJan || !hasDec) partial.add(y);
  }
  return partial;
}

function won(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString("ko-KR") + "원";
}

function etfByCode(code) {
  return state.meta?.etfs?.find((e) => e.code === code) || null;
}

function isSaferAsset(etf) {
  if (!etf) return false;
  if (etf.leveraged) return false;
  if (SAFER_CATS.has(etf.category)) return true;
  if (SAFER_NAME_RE.test(etf.name || "")) return true;
  return false;
}

function annualYieldFor(code) {
  const etf = etfByCode(code);
  if (etf && etf.yield != null && !Number.isNaN(Number(etf.yield))) return Number(etf.yield);
  if (etf && etf.divYield != null && !Number.isNaN(Number(etf.divYield))) return Number(etf.divYield);
  if (INCOME_YIELD[code] != null) return INCOME_YIELD[code];
  if (etf && SAFER_NAME_RE.test(etf.name || "") && etf.category === "해외주식") return 0.025;
  return CAT_YIELD[etf?.category] ?? 0.015;
}

/**
 * DISABLED (no-op). 시세(FDR/NAVER·Yahoo auto_adjust)는 이미 분배금이 반영된 수정주가라
 * 추정 분배율을 다시 복리로 얹으면 분배금이 이중 계산된다(K-올웨더 2012-02~ 기준 연환산 8.0%→10.1%, +2.1%p 과대).
 * 실제 분배금 흐름은 「배당 현금흐름」 모드(원가격 + 실제 분배 이벤트)에서만 계산한다.
 */
function buildTotalReturnPrices(priceMap, codes) {
  return priceMap;
}

/** Legacy synthetic TR (kept for the audit record only; never called). */
function _legacySyntheticTrPrices(priceMap, codes) {
  const out = {};
  for (const code of Object.keys(priceMap)) {
    if (!codes.includes(code) && code !== BENCH) {
      out[code] = priceMap[code];
      continue;
    }
    const src = priceMap[code];
    if (!src) continue;
    const dates = Object.keys(src).sort();
    const daily = annualYieldFor(code) / 252;
    const syn = {};
    let factor = 1;
    let prev = null;
    for (const d of dates) {
      if (prev != null) factor *= 1 + daily;
      syn[d] = src[d] * factor;
      prev = d;
    }
    out[code] = syn;
  }
  return out;
}

function riskyWeightSum(selected) {
  let risky = 0;
  let total = 0;
  for (const [code, w] of Object.entries(selected)) {
    if (!(w > 0)) continue;
    total += w;
    const etf = etfByCode(code);
    if (!isSaferAsset(etf)) risky += w;
  }
  return total > 0 ? (risky / total) * 100 : 0;
}

function updateIrpWarn() {
  const el = $("#irpWarn");
  if (!el) return;
  const riskyPct = riskyWeightSum(state.selected);
  if (riskyPct > 70) {
    el.style.display = "block";
    el.innerHTML =
      `<span class="irp-badge">참고</span> 퇴직연금(IRP/DC) 안전자산 30% 의무 편입 기준 초과` +
      `<div class="irp-hint">위험자산 비중 약 ${riskyPct.toFixed(0)}%. 채권·현금성 비중을 늘리면 30% 안전자산 참고 기준에 가까워집니다. 법률 자문이 아닙니다.</div>`;
  } else {
    el.style.display = "none";
    el.innerHTML = "";
  }
}

/** Load lightweight meta; prices stay selective. */
async function boot() {
  let meta = null;
  try {
    const res = await fetch("./data/etf_meta.json");
    if (res.ok) meta = await res.json();
  } catch (_) {
    /* fall through */
  }

  if (!meta) {
    const res = await fetch("./data/etf_prices.json");
    if (!res.ok) throw new Error("시세 파일이 없습니다. python3 agents/fast_ingest.py 를 실행하세요.");
    const bundle = await res.json();
    meta = bundle;
    state._priceBundle = bundle;
    state.prices = Object.fromEntries(
      Object.entries(bundle.prices || {}).map(([code, rows]) => [
        code,
        Object.fromEntries(rows.map((r) => [r.d, r.c])),
      ])
    );
  } else if (meta.prices) {
    state._priceBundle = meta;
    state.prices = Object.fromEntries(
      Object.entries(meta.prices).map(([code, rows]) => [
        code,
        Object.fromEntries(rows.map((r) => [r.d, r.c])),
      ])
    );
  } else {
    // meta-only Pages path: preload full price bundle once (no data/prices/*.json)
    try {
      const res = await fetch("./data/etf_prices.json");
      if (res.ok) {
        const bundle = await res.json();
        state._priceBundle = bundle;
        state.prices = Object.fromEntries(
          Object.entries(bundle.prices || {}).map(([code, rows]) => [
            code,
            Object.fromEntries(rows.map((r) => [r.d, r.c])),
          ])
        );
      }
    } catch (_) {
      /* ensurePrices will retry */
    }
  }

  state.meta = meta;
  state.pricesAsOf = resolvePricesAsOf(meta, state._priceBundle);
  const asOfLine = state.pricesAsOf ? `시세 기준일 ${state.pricesAsOf}\n` : "";
  $("#stamp").textContent = `${asOfLine}시세 갱신 ${meta.generatedAt}\n${meta.source}\n메타 ${meta.etfs.length}종`;
  renderPresets();
  renderCatFilters();
  renderStructFilters();
  renderList();
  const shared = parseShareHash();
  if (shared && (shared.get("preset") || shared.get("h"))) {
    await applyShareParams(shared);
    // syncStratControls is wired on DOMContentLoaded; call after controls exist
    syncMaFreqHint();
    const maRow = $("#maOverlayRow");
    if (maRow) maRow.style.display = state.maOverlay ? "flex" : "none";
    const rhRow = $("#regimeHedgeRow");
    if (rhRow) rhRow.style.display = state.regimeHedge ? "flex" : "none";
    const gRow = $("#goldOnRow");
    if (gRow) gRow.style.display = state.goldOn ? "flex" : "none";
    const bandRow = $("#bandRow");
    if (bandRow) bandRow.style.display = state.bandOn ? "flex" : "none";
    const momRow = $("#momControls");
    if (momRow)
      momRow.style.display =
        state.rebalance === "MOM" ||
        state.rebalance === "DMOM" ||
        state.rebalance === "MOM12_1" ||
        state.rebalance === "XSMOM"
          ? "flex"
          : "none";
    const cashRow = $("#dmomCashRow");
    if (cashRow)
      cashRow.style.display =
        state.rebalance === "DMOM" ||
        state.maOverlay ||
        (state.regimeHedge && state.regimeHedgeMode === "cash") ||
        state.volTarget ||
        state.sleeveTrend
          ? "flex"
          : "none";
    await run();
  } else {
    await applyPreset("kAllWeather");
  }
}

function renderPresets() {
  const box = $("#presets");
  box.innerHTML = "";
  Object.entries(PRESETS).forEach(([k, p]) => {
    const b = document.createElement("button");
    b.className = "chip" + (p.longProxy ? " proxy" : "");
    b.dataset.key = k;
    b.title = p.proxyTip || (p.longProxy ? PRESET_PROXY_TIP : "");
    if (p.longProxy) {
      b.innerHTML = `${p.label} <span class="proxy-tag" title="${b.title}">10년+용 장기 대용</span>`;
    } else {
      b.textContent = p.label;
    }
    b.onclick = () => applyPreset(k);
    box.appendChild(b);
  });
}

function renderCatFilters() {
  const box = $("#catFilters");
  box.innerHTML = "";
  CATS.forEach((cat) => {
    const b = document.createElement("button");
    b.className = "chip" + (state.category === cat ? " active" : "");
    b.textContent = cat;
    b.onclick = () => {
      state.category = cat;
      renderCatFilters();
      renderList();
    };
    box.appendChild(b);
  });
}

const STRUCT_FILTERS = [
  { key: "hedged", label: "환헤지(H)" },
  { key: "futures", label: "선물" },
  { key: "spot", label: "현물" },
];

function renderStructFilters() {
  const box = $("#structFilters");
  if (!box) return;
  box.innerHTML = "";
  STRUCT_FILTERS.forEach(({ key, label }) => {
    const b = document.createElement("button");
    const on = !!state.structFilters[key];
    b.className = "chip" + (on ? " active" : "");
    b.type = "button";
    b.textContent = label;
    b.title = on ? `${label} 필터 켜짐 (OR)` : `${label}만 보기`;
    b.onclick = () => {
      state.structFilters[key] = !state.structFilters[key];
      renderStructFilters();
      renderList();
    };
    box.appendChild(b);
  });
}

async function applyPreset(key) {
  document.querySelectorAll("#presets .chip").forEach((el) =>
    el.classList.toggle("active", el.dataset.key === key)
  );
  state.activePreset = key;
  state.selected = {};
  const codes = Object.keys(PRESETS[key].w);
  await ensurePrices(codes);
  Object.entries(PRESETS[key].w).forEach(([code, val]) => {
    if (state.meta.etfs.some((e) => e.code === code)) state.selected[code] = val;
  });
  renderList();
  await run();
}


function clearSelection() {
  state.selected = {};
  state.activePreset = null;
  state.lastRun = null;
  document.querySelectorAll("#presets .chip").forEach((el) => el.classList.remove("active"));
  // Force DOM checkboxes off even before re-render (visible feedback).
  document.querySelectorAll("#etfList input[type=checkbox]").forEach((el) => {
    el.checked = false;
  });
  document.querySelectorAll("#etfList input[type=range]").forEach((el) => {
    el.value = "0";
  });
  document.querySelectorAll("#etfList .wnum").forEach((el) => {
    el.textContent = "0%";
  });
  renderList();
  updateSum();
  updateIrpWarn();
  try {
    destroyExtraCharts();
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  } catch (_) {
    /* chart teardown must not block reset */
  }
  state.lastPortCurve = null;
  state.lastBenchCurve = null;
  const host = $("#result");
  if (host) {
    host.innerHTML = `<div class="card pad empty">종목을 선택하거나 프리셋을 고른 뒤 백테스트를 실행하세요.</div>`;
  }
}

function filteredEtfs() {
  const q = state.search.trim().toLowerCase();
  const sf = state.structFilters || {};
  const anyStruct = !!(sf.hedged || sf.futures || sf.spot);
  return state.meta.etfs.filter((etf) => {
    if (state.category !== "전체" && etf.category !== state.category) return false;
    if (anyStruct) {
      const flags = etfStructureFlags(etf);
      const hit =
        (sf.hedged && flags.hedged) ||
        (sf.futures && flags.futures) ||
        (sf.spot && flags.spot);
      if (!hit) return false;
    }
    if (!q) return true;
    const hay = `${etf.name} ${etf.code} ${etf.issuer} ${etf.blurb || ""}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderList() {
  const box = $("#etfList");
  box.innerHTML = "";
  const cats = CATS.slice(1);
  const ordered = [...filteredEtfs()].sort(
    (a, b) =>
      cats.indexOf(a.category) - cats.indexOf(b.category) ||
      (b.marcap || 0) - (a.marcap || 0) ||
      a.name.localeCompare(b.name, "ko")
  );
  if (!ordered.length) {
    box.innerHTML = `<div class="muted-note">검색 결과가 없습니다.</div>`;
    updateSum();
    updateIrpWarn();
    return;
  }
  ordered.forEach((etf) => {
    const on = etf.code in state.selected;
    const el = document.createElement("div");
    el.className = "etf" + (on ? " on" : "") + (etf.leveraged ? " lev" : "");
    el.setAttribute("data-etf", etf.code);
    const levTag = etf.leveraged ? " · 레버리지/인버스" : "";
    const flags = etfStructureFlags(etf);
    const badgeHtml = structureBadgeHtml(flags);
    el.innerHTML = `<div class="etf-head"><input type="checkbox" ${on ? "checked" : ""} data-code="${etf.code}" /><div><div class="etf-name">${etf.name}${badgeHtml}</div><div class="etf-code">${etf.code} · ${etf.issuer}${levTag} · ${etf.start || "?"}~</div></div><span class="cat">${etf.category}</span></div><div class="weight-row" style="${on ? "" : "display:none"}"><input type="range" min="0" max="100" value="${state.selected[etf.code] || 0}" data-range="${etf.code}" /><div class="wnum">${state.selected[etf.code] || 0}%</div></div>`;
    el.querySelector("input[type=checkbox]").onchange = async (e) => {
      if (e.target.checked) {
        await ensurePrices([etf.code]);
        state.selected[etf.code] = 10;
      } else delete state.selected[etf.code];
      state.activePreset = null;
      renderList();
    };
    const range = el.querySelector("input[type=range]");
    if (range)
      range.oninput = (e) => {
        const w = Number(e.target.value);
        if (w <= 0) {
          delete state.selected[etf.code];
          el.querySelector("input[type=checkbox]").checked = false;
          el.classList.remove("on");
          el.querySelector(".weight-row").style.display = "none";
        } else {
          state.selected[etf.code] = w;
          el.querySelector(".wnum").textContent = w + "%";
        }
        state.activePreset = null;
        updateSum();
        updateIrpWarn();
      };
    box.appendChild(el);
  });
  updateSum();
  updateIrpWarn();
}


/** Short display name for glance chips (truncate long ETF names). */
function shortEtfName(etf) {
  if (!etf || !etf.name) return "";
  const n = etf.name;
  return n.length > 18 ? n.slice(0, 17) + "…" : n;
}

function glanceColor(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 55%)`;
}

function renderSelGlance() {
  const title = $("#selGlanceTitle");
  const empty = $("#selGlanceEmpty");
  const bar = $("#selGlanceBar");
  const list = $("#selGlanceList");
  if (!title || !empty || !bar || !list) return;
  const picks = Object.entries(state.selected)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const sum = picks.reduce((a, [, w]) => a + w, 0);
  const sumLabel = Number.isInteger(sum) ? String(sum) : sum.toFixed(1);
  title.textContent = `선택 ${picks.length}종 · 합 ${sumLabel}%`;
  if (!picks.length) {
    empty.hidden = false;
    empty.style.display = "";
    bar.hidden = true;
    list.hidden = true;
    list.innerHTML = "";
    bar.innerHTML = "";
    return;
  }
  empty.hidden = true;
  empty.style.display = "none";
  bar.hidden = false;
  list.hidden = false;
  const denom = sum > 0 ? sum : 1;
  bar.innerHTML = picks
    .map(([code, w]) => {
      const pct = (w / denom) * 100;
      return `<span style="width:${pct}%;background:${glanceColor(code)}" title="${code} ${w}%"></span>`;
    })
    .join("");
  list.innerHTML = picks
    .map(([code, w]) => {
      const etf = etfByCode(code);
      const name = shortEtfName(etf) || code;
      const flags = etf ? etfStructureFlags(etf) : { hedged: false, futures: false, spot: false };
      const badge = structureBadgeHtml(flags);
      const cat = etf && etf.category ? `<span class="cat">${etf.category}</span>` : "";
      const wLabel = Number.isInteger(w) ? `${w}%` : `${Number(w).toFixed(1)}%`;
      return `<div class="sel-glance-row" data-glance="${code}" title="${etf ? etf.name : code}">
        <span class="sel-glance-swatch" style="background:${glanceColor(code)}"></span>
        <div class="sel-glance-meta">
          <div class="sel-glance-name">${name}${badge}</div>
          <div class="sel-glance-sub"><code>${code}</code>${cat}</div>
        </div>
        <div class="sel-glance-w">${wLabel}</div>
        <div class="sel-glance-acts">
          <button type="button" data-adj="${code}" data-delta="-5" title="비중 −5">−</button>
          <button type="button" data-adj="${code}" data-delta="5" title="비중 +5">+</button>
          <button type="button" class="rm" data-rm="${code}" title="선택 해제">×</button>
        </div>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".sel-glance-row").forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest("button")) return;
      focusEtfInList(row.getAttribute("data-glance"));
    };
  });
  list.querySelectorAll("button[data-rm]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      removeGlanceCode(btn.getAttribute("data-rm"));
    };
  });
  list.querySelectorAll("button[data-adj]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      adjustGlanceWeight(btn.getAttribute("data-adj"), Number(btn.getAttribute("data-delta")));
    };
  });
}

async function focusEtfInList(code) {
  if (!code) return;
  // Clear filters if the row is hidden by search/category/struct
  const visible = document.querySelector(`#etfList .etf[data-etf="${code}"]`);
  if (!visible) {
    state.search = "";
    state.category = "전체";
    state.structFilters = { hedged: false, futures: false, spot: false };
    const search = $("#etfSearch");
    if (search) search.value = "";
    renderCatFilters();
    renderStructFilters();
    renderList();
  }
  const el = document.querySelector(`#etfList .etf[data-etf="${code}"]`);
  if (!el) return;
  const box = $("#etfList");
  if (box) {
    const top = el.offsetTop - box.offsetTop;
    box.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
  }
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 900);
}

function removeGlanceCode(code) {
  if (!(code in state.selected)) return;
  delete state.selected[code];
  state.activePreset = null;
  renderList();
}

function adjustGlanceWeight(code, delta) {
  if (!(code in state.selected) && !(delta > 0)) return;
  const cur = state.selected[code] || 0;
  const next = Math.max(0, Math.min(100, cur + delta));
  state.activePreset = null;
  if (next <= 0) delete state.selected[code];
  else state.selected[code] = next;
  renderList();
}

function portLineHtml(picks) {
  if (!picks || !picks.length) return "";
  const total = picks.reduce((s, [, w]) => s + Number(w), 0) || 1;
  const chips = picks
    .map(([c, w]) => {
      const nw = (Number(w) / total) * 100;
      const label = Number.isInteger(Math.round(nw * 10) / 10) && Math.abs(nw - Math.round(nw)) < 1e-6
        ? `${Math.round(nw)}%`
        : `${nw.toFixed(1)}%`;
      return `<span class="port-chip"><code>${c}</code><span class="pc-w">${label}</span></span>`;
    })
    .join("");
  return `<div class="port-line"><span class="port-label">이번 포트</span><span class="port-chips">${chips}</span></div>`;
}

function updateSum() {
  const sum = Object.values(state.selected).reduce((a, b) => a + b, 0);
  const sumEl = $("#sum");
  if (sumEl) {
    sumEl.textContent = `비중 합 ${sum}%`;
    sumEl.style.color = Math.abs(sum - 100) < 1e-6 ? "var(--accent)" : "var(--accent2)";
  }
  renderSelGlance();
}

/** Selective price loader: selected tickers + benchmark only.
 * Prefer etf_prices.json bundle first (GitHub Pages does not ship data/prices/).
 * Per-ticker files are a local/dev fallback only — avoids console 404 noise on Pages.
 */
async function ensurePrices(codes) {
  const need = [...new Set([...codes, BENCH])].filter((c) => !state.prices[c]);
  if (!need.length) return;
  state.loadingPrices = true;
  try {
    if (!state._priceBundle) {
      try {
        const res = await fetch("./data/etf_prices.json");
        if (res.ok) state._priceBundle = await res.json();
      } catch {
        /* ignore */
      }
    }
    const missing = [];
    for (const code of need) {
      const rows = state._priceBundle && state._priceBundle.prices && state._priceBundle.prices[code];
      if (rows) state.prices[code] = Object.fromEntries(rows.map((r) => [r.d, r.c]));
      else missing.push(code);
    }
    // data/prices/ is gitignored and not on GitHub Pages — never fetch it
    // (avoids console 404). Local selective files: merge into etf_prices.json via ingest.
    if (missing.length && !state._priceBundle) {
      console.warn("시세 번들(etf_prices.json)을 불러오지 못했습니다.", missing);
    }
  } finally {
    state.loadingPrices = false;
  }
}

function periodBounds() {
  const ends = state.meta.etfs.map((e) => e.end).filter(Boolean).sort();
  const end = ends.at(-1);
  // Custom dates only when period === "custom". Hidden inputs still have
  // default values (e.g. 2021-01-01) which must NOT override 10y/max.
  if (state.period === "custom") {
    const customStart = $("#startDate").value;
    const customEnd = $("#endDate").value;
    if (customStart && customEnd) return [customStart, customEnd];
  }
  const years = { "1y": 1, "3y": 3, "5y": 5, "10y": 10, max: 25 }[state.period] || 5;
  const startDt = new Date(end + "T00:00:00");
  startDt.setFullYear(startDt.getFullYear() - years);
  return [startDt.toISOString().slice(0, 10), end];
}

function computeDailyLogReturns(code, dates) {
  const px = state.prices[code];
  const rets = [];
  for (let i = 1; i < dates.length; i++) {
    const a = px[dates[i - 1]];
    const b = px[dates[i]];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
    else rets.push(0);
  }
  return rets;
}

function pearsonCorr(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i];
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return 0;
  const c = cov / Math.sqrt(vx * vy);
  if (!Number.isFinite(c)) return 0;
  return Math.max(-1, Math.min(1, c));
}

function buildCorrMatrix(codes, start, end) {
  if (codes.length < 2) return null;
  const sets = codes.map((c) => new Set(Object.keys(state.prices[c] || {}).filter((d) => d >= start && d <= end)));
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  if (common.length < 20) return null;
  const rets = Object.fromEntries(codes.map((c) => [c, computeDailyLogReturns(c, common)]));
  const n = codes.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  let sumOff = 0,
    countOff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = i === j ? 1 : pearsonCorr(rets[codes[i]], rets[codes[j]]);
      matrix[i][j] = c == null ? 0 : c;
      if (i < j) {
        sumOff += matrix[i][j];
        countOff += 1;
      }
    }
  }
  return {
    codes,
    matrix,
    meanPairwise: countOff ? sumOff / countOff : 0,
    days: common.length,
  };
}

function corrCellColor(c) {
  const v = Math.max(-1, Math.min(1, c));
  if (v >= 0) {
    const t = v;
    const r = Math.round(90 + 140 * t);
    const g = Math.round(100 * (1 - t) + 40);
    const b = Math.round(110 * (1 - t) + 40);
    return `rgb(${r},${g},${b})`;
  }
  const t = -v;
  const r = Math.round(90 * (1 - t) + 30);
  const g = Math.round(110 + 80 * t);
  const b = Math.round(130 + 90 * t);
  return `rgb(${r},${g},${b})`;
}

function corrSummary(mean) {
  if (mean >= 0.7) return `평균 상관계수 ${mean.toFixed(2)} · 자산 간 움직임이 비교적 비슷했던 구간입니다.`;
  if (mean >= 0.4) return `평균 상관계수 ${mean.toFixed(2)} · 중간 수준의 동행성이 관측됩니다.`;
  if (mean >= 0.15) return `평균 상관계수 ${mean.toFixed(2)} · 동행성이 낮아 분산 효과가 나타날 수 있는 구간입니다.`;
  if (mean >= -0.15) return `평균 상관계수 ${mean.toFixed(2)} · 거의 무상관에 가까운 구간입니다.`;
  return `평균 상관계수 ${mean.toFixed(2)} · 역상관 경향이 관측된 구간입니다.`;
}

function renderCorrCard(corr) {
  if (!corr) return "";
  const labels = corr.codes.map((c) => {
    const e = etfByCode(c);
    const short = (e?.name || c).replace(/^(KODEX|TIGER|ACE|KIWOOM|PLUS|RISE|SOL)\s*/, "");
    return short.length > 10 ? short.slice(0, 9) + "…" : short;
  });
  const head = `<tr><th></th>${labels.map((l) => `<th title="${l}">${l}</th>`).join("")}</tr>`;
  const body = corr.matrix
    .map(
      (row, i) =>
        `<tr><th title="${corr.codes[i]}">${labels[i]}</th>` +
        row
          .map((v, j) => {
            const txt = i === j ? "1.00" : v.toFixed(2);
            return `<td class="corr-cell" style="background:${corrCellColor(v)}" title="${corr.codes[i]} vs ${corr.codes[j]}: ${txt}">${txt}</td>`;
          })
          .join("") +
        `</tr>`
    )
    .join("");
  return `<div class="card pad corr-card"><div class="section-title">자산 간 상관관계 매트릭스</div><div class="corr-scroll"><table class="corr-table"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="warn">${corrSummary(corr.meanPairwise)} · 공통 ${corr.days}거래일 로그수익률 · 과거 관측값</div></div>`;
}

/**
 * Simplified tax model (not tax advice).
 * 시세가 수정주가(분배금 세전 재투자 포함)이므로 기말 평가액에는 추정 분배금이 이미 들어 있다.
 * Taxable: (a) 추정 분배금 = 평균자본 × 모델 분배율 × 연수 → 15.4% (보유 중 원천징수)
 *          (b) 매매차익 = 기말 − 원금 − 추정 분배금 (분배금 부분은 (a)에서 과세 → 이중과세 제외)
 *              국내주식형 0%(매매차익 비과세), 그 외(국내상장 해외·채권·원자재 등) 15.4% — 비중 가중
 * Pension: no annual tax; exit tax at selected pension rate on the whole gain (unchanged).
 */
const TAX_DIST_RATE = 0.154;
function exitTaxRateFor(code) {
  const etf = etfByCode(code);
  return etf && etf.category === "국내주식" ? 0 : TAX_DIST_RATE;
}

function simulateTax(result, picks) {
  const invested = result.totalInvested;
  const final = result.finalValue;
  const years = Math.max(result.years || 0, 0);
  const tw = result.weights || {};
  let yld = 0;
  let exitRate = 0;
  for (const [c, w] of Object.entries(tw)) {
    yld += w * annualYieldFor(c);
    exitRate += w * exitTaxRateFor(c);
  }

  const avgCapital = (invested + final) / 2;
  const totalGain = Math.max(0, final - invested);
  const estDistributions = Math.min(totalGain, avgCapital * yld * years);
  const annualYieldTax = estDistributions * TAX_DIST_RATE;
  const priceGain = Math.max(0, totalGain - estDistributions);
  const exitTax = priceGain * exitRate;
  const taxableFinal = final - annualYieldTax - exitTax;

  const pensionRate = state.pensionTaxRate;
  const pensionGain = Math.max(0, final - invested);
  const pensionFinal = final - pensionGain * pensionRate;

  const activeFinal = state.accountType === "pension" ? pensionFinal : taxableFinal;
  const bonus = pensionFinal - taxableFinal;

  return {
    yld,
    exitRate,
    estDistributions,
    annualYieldTax,
    exitTax,
    taxableFinal,
    pensionFinal,
    pensionRate,
    activeFinal,
    bonus,
    invested,
    preTaxFinal: final,
  };
}

function renderTaxCard(tax) {
  if (!tax) return "";
  const mode =
    state.accountType === "pension"
      ? `연금저축/IRP/ISA · 인출세 ${(tax.pensionRate * 100).toFixed(1)}%`
      : `일반 계좌 · 추정 분배금 15.4% + 매매차익(국내주식형 비과세·그 외 15.4%, 가중 ${(tax.exitRate * 100).toFixed(1)}%)`;
  return `<div class="card pad"><div class="section-title">절세 비교 (단순 모형)</div>
    <div class="tax-grid">
      <div><div class="label">세전 기말</div><div class="val">${won(tax.preTaxFinal)}</div></div>
      <div><div class="label">일반 계좌 모형</div><div class="val">${won(tax.taxableFinal)}</div></div>
      <div><div class="label">연금 계좌 모형</div><div class="val">${won(tax.pensionFinal)}</div></div>
      <div><div class="label">절세 보너스</div><div class="val ${tax.bonus >= 0 ? "pos" : "neg"}">${won(tax.bonus)}</div></div>
    </div>
    <div class="warn">선택: ${mode} · 포트 모델 분배율 ~${(tax.yld * 100).toFixed(1)}%/년(추정치) · 시세가 수정주가라 분배금은 기말 평가액에 이미 포함 → 분배금 과세분은 매매차익에서 제외(이중과세 없음) · 수수료·중도인출·한도 미반영 · 세무 자문 아님</div>
  </div>`;
}

async function run() {
  const picks = Object.entries(state.selected).filter(([, w]) => w > 0);
  if (!picks.length) return;
  const codes = picks.map(([c]) => c);
  const needCash =
    state.rebalance === "DMOM" ||
    state.maOverlay ||
    (state.regimeHedge && state.regimeHedgeMode === "cash") ||
    state.volTarget ||
    state.sleeveTrend;
  const needHedge = !!state.regimeHedge;
  const needGold = !!state.goldOn;
  const extra = [BENCH];
  if (needCash) extra.push(state.cashCode || "153130");
  if (needHedge) {
    extra.push(REGIME_HEDGE_B);
    if (state.regimeHedgeMode === "inverse") extra.push(state.regimeHedgeCode || "114800");
    else extra.push(state.cashCode || "153130");
  }
  if (needGold) {
    extra.push(resolveGoldCode(state.goldCode), GOLD_CASH);
  }
  await ensurePrices([...codes, ...extra]);
  for (const c of codes) {
    if (!state.prices[c]) {
      $("#result").innerHTML = `<div class="card pad empty">${c} 시세가 없습니다. fast_ingest 를 다시 실행하세요.</div>`;
      return;
    }
  }
  if (needCash && !state.prices[state.cashCode || "153130"]) {
    $("#result").innerHTML = `<div class="card pad empty">안전자산 ${state.cashCode} 시세가 없습니다.</div>`;
    return;
  }
  if (needHedge) {
    if (!state.prices[REGIME_HEDGE_B]) {
      $("#result").innerHTML = `<div class="card pad empty">국면 헤지 신호용 ${REGIME_HEDGE_B} 시세가 없습니다.</div>`;
      return;
    }
    const hCode =
      state.regimeHedgeMode === "cash"
        ? state.cashCode || "153130"
        : state.regimeHedgeCode || "114800";
    if (hCode === "252670") {
      $("#result").innerHTML = `<div class="card pad empty">2X 인버스는 국면 헤지(실험)에서 금지입니다 (−1x 114800만 허용).</div>`;
      return;
    }
    if (state.regimeHedgeMode === "inverse" && hCode !== "114800") {
      $("#result").innerHTML = `<div class="card pad empty">인버스 헤지는 114800 (−1x)만 허용합니다.</div>`;
      return;
    }
    if (!state.prices[hCode]) {
      $("#result").innerHTML = `<div class="card pad empty">국면 헤지 자산 ${hCode} 시세가 없습니다.</div>`;
      return;
    }
  }
  if (needGold) {
    const gCode = resolveGoldCode(state.goldCode);
    if (!state.prices[gCode]) {
      $("#result").innerHTML = `<div class="card pad empty">금 슬리브 신호용 ${gCode} 시세가 없습니다.</div>`;
      return;
    }
    if (!state.prices[GOLD_CASH]) {
      $("#result").innerHTML = `<div class="card pad empty">금 슬리브 현금대리 ${GOLD_CASH} 시세가 없습니다.</div>`;
      return;
    }
  }
  const [start, end] = periodBounds();
  const initial = state.dcaOn ? state.initialCapital : 1;
  const monthly = state.dcaOn ? state.monthlyAmount : 0;
  const hedgeLoad =
    needHedge
      ? [
          REGIME_HEDGE_B,
          state.regimeHedgeMode === "cash"
            ? state.cashCode || "153130"
            : state.regimeHedgeCode || "114800",
        ]
      : [];
  const loadCodes = [
    ...new Set([
      ...codes,
      BENCH,
      ...(needCash ? [state.cashCode || "153130"] : []),
      ...hedgeLoad,
      ...(needGold ? [resolveGoldCode(state.goldCode), GOLD_CASH] : []),
    ]),
  ];
  const useTr = state.totalReturn && hasRealTrData();
  const priceMap = useTr
    ? buildTotalReturnPrices(state.prices, loadCodes)
    : state.prices;
  if (
    (state.rebalance === "MOM" ||
      state.rebalance === "DMOM" ||
      state.rebalance === "MOM12_1" ||
      state.rebalance === "XSMOM") &&
    !picks.length
  ) {
    $("#result").innerHTML = `<div class="card pad empty">모멘텀 유니버스가 비어 있습니다. ETF를 선택하세요.</div>`;
    return;
  }
  if (state.rebalance === "XSMOM" && picks.length < 5) {
    $("#result").innerHTML = `<div class="card pad empty">XS 모멘텀은 유니버스 5종 이상이 필요합니다.</div>`;
    return;
  }
  const result = backtest(
    Object.fromEntries(picks),
    priceMap,
    start,
    end,
    state.rebalance,
    initial,
    monthly,
    {
      lookback: state.momLookback,
      topN: state.momTopN,
      cost: clampTradeCost(state.tradeCost),
      weighting: state.weighting,
      volWindow: state.volWindow,
      maOverlay: state.maOverlay,
      maWindow: state.maWindow,
      maSignalFreq: normMaSignalFreq(state.maSignalFreq),
      cashCode: state.cashCode || "153130",
      maCashPct: state.maCashPct,
      regimeHedge: state.regimeHedge,
      regimeHedgeMode: state.regimeHedgeMode,
      regimeHedgePct: Math.min(0.15, Math.max(0, Number(state.regimeHedgePct) || 0.15)),
      regimeHedgeCode: state.regimeHedgeCode || "114800",
      goldOn: state.goldOn,
      goldSleevePct: clampGoldSleeve(state.goldSleevePct),
      goldLookback: state.goldLookback,
      goldCode: resolveGoldCode(state.goldCode),
      bandOn: !!state.bandOn,
      bandPct: clampBandPct(state.bandPct),
      volTarget: !!state.volTarget,
      volTargetPct: Math.max(0.01, Math.min(0.5, Number(state.volTargetPct) || 0.1)),
      volTargetWindow: Math.max(5, Number(state.volTargetWindow) || 60),
      sleeveTrend: !!state.sleeveTrend,
      sleeveTrendMode: state.sleeveTrendMode === "ma" ? "ma" : "abs",
      sleeveTrendLookback: Number(state.sleeveTrendLookback) >= 3 ? 3 : 1,
      etfFlags: etfFlagsMap(),
    }
  );
  const bench = backtest({ [BENCH]: 100 }, priceMap, result.start || start, result.end || end, "Q", 1, 0);
  const corr = result.error ? null : buildCorrMatrix(codes, result.start || start, result.end || end);
  const tax =
    result.error || !state.dcaOn
      ? result.error
        ? null
        : simulateTax(
            {
              ...result,
              totalInvested: result.totalInvested || 1,
              finalValue: result.finalValue || 1 + (result.totalRet || 0),
            },
            picks
          )
      : simulateTax(result, picks);
  // For lump-sum mode initialCapital=1, scale tax display to 10M for readability
  let taxView = tax;
  if (tax && !state.dcaOn) {
    const scale = 10_000_000;
    taxView = {
      ...tax,
      preTaxFinal: tax.preTaxFinal * scale,
      taxableFinal: tax.taxableFinal * scale,
      pensionFinal: tax.pensionFinal * scale,
      bonus: tax.bonus * scale,
      invested: tax.invested * scale,
      annualYieldTax: tax.annualYieldTax * scale,
      exitTax: tax.exitTax * scale,
      estDistributions: tax.estDistributions * scale,
    };
  }
  const windowInfo = result.error ? null : buildWindowInfo(result, picks, start, end);
  state.lastRun = result.error
    ? null
    : { result, picks, bench, corr, tax: taxView, windowInfo, requestedStart: start, requestedEnd: end };
  state.sensitivityToken += 1;
  state.sensitivityRunning = false;
  state.sensitivityResult = null;
  renderResult(result, bench, picks, corr, taxView, windowInfo);
}

/**
 * Same-day: mark-to-market THEN rebalance.
 * DCA: on first trading day of each new month, add cash then buy to target weights.
 * Numbers are computed only here (and in agents/build_backtest.py).
 */
function shiftMonth(ym, delta) {
  let y = Number(ym.slice(0, 4));
  let m = Number(ym.slice(5, 7)) + delta;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

function monthEndCloses(priceMap) {
  const byM = {};
  for (const d of Object.keys(priceMap)) {
    const ym = d.slice(0, 7);
    if (!byM[ym] || d > byM[ym]) byM[ym] = d;
  }
  const out = {};
  for (const [ym, d] of Object.entries(byM)) out[ym] = [d, priceMap[d]];
  return out;
}

function momentumPick(universe, priceMap, signalMonth, lookback, topN, monthEndsCache) {
  const endYm = shiftMonth(signalMonth, -1);
  const startYm = shiftMonth(endYm, -lookback);
  const scored = [];
  for (const c of universe) {
    const ends = monthEndsCache[c] || {};
    if (!ends[endYm] || !ends[startYm]) continue;
    const [ed, endPx] = ends[endYm];
    const [, startPx] = ends[startYm];
    if (!(startPx > 0) || !(endPx > 0)) continue;
    if (ed.slice(0, 7) >= signalMonth) continue; // no look-ahead
    scored.push([endPx / startPx - 1, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  let picked = scored.slice(0, Math.max(1, topN)).map((x) => x[1]);
  if (!picked.length) picked = [...universe];
  const n = picked.length;
  const tw = Object.fromEntries(picked.map((c) => [c, 1 / n]));
  return [picked, tw];
}

function lookbackReturn(code, signalMonth, lookback, monthEndsCache) {
  const endYm = shiftMonth(signalMonth, -1);
  const startYm = shiftMonth(endYm, -lookback);
  const ends = monthEndsCache[code] || {};
  if (!ends[endYm] || !ends[startYm]) return null;
  const [ed, endPx] = ends[endYm];
  const [, startPx] = ends[startYm];
  if (!(startPx > 0) || !(endPx > 0)) return null;
  if (ed.slice(0, 7) >= signalMonth) return null;
  return endPx / startPx - 1;
}

function dualMomentumPick(universe, priceMap, signalMonth, lookback, topN, monthEndsCache, cashCode) {
  const endYm = shiftMonth(signalMonth, -1);
  const startYm = shiftMonth(endYm, -lookback);
  const scored = [];
  for (const c of universe) {
    const ends = monthEndsCache[c] || {};
    if (!ends[endYm] || !ends[startYm]) continue;
    const [ed, endPx] = ends[endYm];
    const [, startPx] = ends[startYm];
    if (!(startPx > 0) || !(endPx > 0)) continue;
    if (ed.slice(0, 7) >= signalMonth) continue;
    scored.push([endPx / startPx - 1, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  const pickedScored = scored.slice(0, Math.max(1, topN));
  if (!pickedScored.length) return [[cashCode], { [cashCode]: 1 }];
  const cashRet = lookbackReturn(cashCode, signalMonth, lookback, monthEndsCache);
  const slots = [];
  for (const [ret, c] of pickedScored) {
    if (cashRet != null && ret <= cashRet) slots.push(cashCode);
    else slots.push(c);
  }
  const n = slots.length;
  const tw = {};
  for (const c of slots) tw[c] = (tw[c] || 0) + 1 / n;
  return [Object.keys(tw), tw];
}


function momentumPick12_1(universe, priceMap, signalMonth, topN, monthEndsCache) {
  // 12-1: 12m return ending at prior-prior month-end (skip most recent 1m). No lookahead.
  const endYm = shiftMonth(signalMonth, -2);
  const startYm = shiftMonth(endYm, -12);
  const scored = [];
  for (const c of universe) {
    const ends = monthEndsCache[c] || {};
    if (!ends[endYm] || !ends[startYm]) continue;
    const [ed, endPx] = ends[endYm];
    const [, startPx] = ends[startYm];
    if (!(startPx > 0) || !(endPx > 0)) continue;
    if (ed.slice(0, 7) >= signalMonth) continue;
    scored.push([endPx / startPx - 1, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  let picked = scored.slice(0, Math.max(1, topN)).map((x) => x[1]);
  if (!picked.length) picked = [...universe];
  const n = picked.length;
  const tw = Object.fromEntries(picked.map((c) => [c, 1 / n]));
  return [picked, tw];
}

function xsMomentumPick(universe, priceMap, signalMonth, lookback, topN, monthEndsCache) {
  if (universe.length < 5) {
    throw new Error("XS 모멘텀은 유니버스 5종 이상이 필요합니다.");
  }
  const endYm = shiftMonth(signalMonth, -1);
  const startYm = shiftMonth(endYm, -lookback);
  const scoredRaw = [];
  for (const c of universe) {
    const ends = monthEndsCache[c] || {};
    if (!ends[endYm] || !ends[startYm]) continue;
    const [ed, endPx] = ends[endYm];
    const [, startPx] = ends[startYm];
    if (!(startPx > 0) || !(endPx > 0)) continue;
    if (ed.slice(0, 7) >= signalMonth) continue;
    scoredRaw.push([endPx / startPx - 1, c]);
  }
  if (!scoredRaw.length) {
    const n = universe.length;
    return [universe.slice(), Object.fromEntries(universe.map((c) => [c, 1 / n]))];
  }
  const meanRet = scoredRaw.reduce((s, x) => s + x[0], 0) / scoredRaw.length;
  const scored = scoredRaw.map(([r, c]) => [r - meanRet, c]);
  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
  const picked = scored.slice(0, Math.max(1, topN)).map((x) => x[1]);
  const n = picked.length;
  return [picked, Object.fromEntries(picked.map((c) => [c, 1 / n]))];
}

function etfFlagsMap() {
  const out = {};
  const list = (state.meta && state.meta.etfs) || [];
  for (const e of list) {
    out[e.code] = { category: e.category || "기타", leveraged: !!e.leveraged };
  }
  return out;
}

function portfolioTrailingVolAnn(tw, priceMap, asof, window = 60) {
  const codes = Object.keys(tw).filter((c) => tw[c] > 0 && priceMap[c]);
  if (!codes.length) return null;
  const total = codes.reduce((s, c) => s + tw[c], 0);
  if (!(total > 0)) return null;
  const norm = Object.fromEntries(codes.map((c) => [c, tw[c] / total]));
  let dates = Object.keys(priceMap[codes[0]])
    .filter((d) => d < asof)
    .sort();
  for (const c of codes.slice(1)) {
    const set = new Set(Object.keys(priceMap[c]));
    dates = dates.filter((d) => set.has(d));
  }
  if (dates.length < window + 1) return null;
  const use = dates.slice(-(window + 1));
  const rets = [];
  for (let i = 1; i < use.length; i++) {
    let r = 0;
    for (const c of codes) {
      const pa = priceMap[c][use[i - 1]];
      const pb = priceMap[c][use[i]];
      if (!(pa > 0) || !(pb > 0)) return null;
      r += norm[c] * (pb / pa - 1);
    }
    rets.push(r);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sig = Math.sqrt(variance);
  if (!(sig > 1e-15)) return null;
  return sig * Math.sqrt(252);
}

function applyVolTarget(tw, priceMap, asof, targetVol, window, cashCode, flags) {
  const fl = flags || {};
  let cashW = tw[cashCode] || 0;
  const risky = {};
  let dropped = 0;
  for (const [c, w] of Object.entries(tw)) {
    if (!(w > 0)) continue;
    if (c === cashCode) continue;
    if (fl[c] && fl[c].leveraged) {
      dropped += w;
      continue;
    }
    risky[c] = w;
  }
  cashW += dropped;
  const rKeys = Object.keys(risky);
  if (!rKeys.length) return { [cashCode]: 1 };
  const rsum = rKeys.reduce((s, c) => s + risky[c], 0);
  const riskyUnit = Object.fromEntries(rKeys.map((c) => [c, risky[c] / rsum]));
  const portVol = portfolioTrailingVolAnn(riskyUnit, priceMap, asof, window);
  const scale =
    portVol == null || !(portVol > 0) ? 1 : Math.min(1, Number(targetVol) / portVol);
  const out = {};
  for (const c of rKeys) out[c] = risky[c] * scale;
  const used = Object.values(out).reduce((a, b) => a + b, 0);
  out[cashCode] = Math.max(0, 1 - used);
  const s = Object.values(out).reduce((a, b) => a + b, 0);
  if (!(s > 0)) return { [cashCode]: 1 };
  return Object.fromEntries(Object.entries(out).filter(([, w]) => w > 1e-15).map(([c, w]) => [c, w / s]));
}

function applySleeveTrend(
  tw,
  signalMonth,
  monthEndsCache,
  priceMap,
  asof,
  cashCode,
  mode,
  lookback,
  maWindow,
  flags
) {
  const fl = flags || {};
  const sleeves = {};
  let cashW = tw[cashCode] || 0;
  for (const [c, w] of Object.entries(tw)) {
    if (!(w > 0)) continue;
    if (c === cashCode) continue;
    const cat = (fl[c] && fl[c].category) || "기타";
    if (!sleeves[cat]) sleeves[cat] = {};
    sleeves[cat][c] = w;
  }
  const out = {};
  for (const [cat, members] of Object.entries(sleeves)) {
    if (cat === "현금성") {
      for (const [c, w] of Object.entries(members)) out[c] = (out[c] || 0) + w;
      continue;
    }
    let on = false;
    if (mode === "ma") {
      const proxy = Object.entries(members).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      const pm = priceMap[proxy];
      on = pm ? maRiskOn(pm, asof, maWindow) : false;
    } else {
      const rets = [];
      let ok = true;
      for (const c of Object.keys(members)) {
        const r = lookbackReturn(c, signalMonth, lookback, monthEndsCache);
        if (r == null) {
          ok = false;
          break;
        }
        rets.push(r);
      }
      on = ok && rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length > 0 : false;
    }
    if (on) {
      for (const [c, w] of Object.entries(members)) out[c] = (out[c] || 0) + w;
    } else {
      cashW += Object.values(members).reduce((a, b) => a + b, 0);
    }
  }
  out[cashCode] = (out[cashCode] || 0) + cashW;
  const s = Object.values(out).reduce((a, b) => a + b, 0);
  if (!(s > 0)) return { [cashCode]: 1 };
  return Object.fromEntries(Object.entries(out).filter(([, w]) => w > 1e-15).map(([c, w]) => [c, w / s]));
}

function trailingVol(priceMap, asof, window = 60) {
  const dates = Object.keys(priceMap)
    .filter((d) => d < asof)
    .sort();
  if (dates.length < window + 1) return null;
  const use = dates.slice(-(window + 1));
  const logs = [];
  for (let i = 1; i < use.length; i++) {
    const pa = priceMap[use[i - 1]];
    const pb = priceMap[use[i]];
    if (!(pa > 0) || !(pb > 0)) return null;
    logs.push(Math.log(pb / pa));
  }
  if (logs.length < 2) return null;
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const variance = logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1);
  const sig = Math.sqrt(variance);
  if (!(sig > 1e-15)) return null;
  return sig;
}

function invVolWeights(codes, priceMap, asof, window = 60, fallbackTw = null) {
  const vols = {};
  for (const c of codes) {
    if (!priceMap[c]) continue;
    const v = trailingVol(priceMap[c], asof, window);
    if (v != null) vols[c] = v;
  }
  const keys = Object.keys(vols);
  if (!keys.length) {
    if (fallbackTw) {
      const out = {};
      for (const c of codes) if (fallbackTw[c] != null) out[c] = fallbackTw[c];
      return Object.keys(out).length ? out : { ...fallbackTw };
    }
    const n = codes.length;
    return Object.fromEntries(codes.map((c) => [c, 1 / n]));
  }
  const inv = Object.fromEntries(keys.map((c) => [c, 1 / vols[c]]));
  const s = keys.reduce((a, c) => a + inv[c], 0);
  return Object.fromEntries(keys.map((c) => [c, inv[c] / s]));
}

/** [riskOn, signalCloseDate]: prior close >= SMA(window), closes strictly before asof. */
function maSignal(benchPrices, asof, window = 200) {
  const dates = Object.keys(benchPrices)
    .filter((d) => d < asof)
    .sort();
  if (dates.length < window) return [true, dates.length ? dates[dates.length - 1] : null];
  const windowDates = dates.slice(-window);
  let sum = 0;
  for (const d of windowDates) sum += benchPrices[d];
  const sma = sum / window;
  const prior = benchPrices[dates[dates.length - 1]];
  return [prior >= sma, dates[dates.length - 1]];
}

function maRiskOn(benchPrices, asof, window = 200) {
  return maSignal(benchPrices, asof, window)[0];
}

/** MA signal frequency: "monthly" (default, month-start) | "rebal" (legacy, rebalance dates only). */
const MA_SIGNAL_FREQS = ["monthly", "rebal"];
function normMaSignalFreq(v) {
  return v === "rebal" ? "rebal" : "monthly";
}
/** UI-only hint: 'rebal' MA signal + rebalance N (no band) → MA state is never checked (0 switches). */
function syncMaFreqHint() {
  if (typeof document === "undefined" || !document.getElementById) return;
  const el = document.getElementById("maFreqHint");
  if (!el) return;
  const show =
    !!state.maOverlay && normMaSignalFreq(state.maSignalFreq) === "rebal" && state.rebalance === "N" && !state.bandOn;
  el.style.display = show ? "block" : "none";
}
/** Month-start cutoff: signal uses closes strictly before YYYY-MM-01 (previous month-end). */
function maMonthAsof(d) {
  return d.slice(0, 7) + "-01";
}

function applyMaOverlay(tw, riskOn, cashCode, maCashPct) {
  if (riskOn) return { ...tw };
  const cashPct = Math.min(1, Math.max(0, Number(maCashPct)));
  const scale = 1 - cashPct;
  const out = {};
  for (const [c, w] of Object.entries(tw)) {
    if (c === cashCode) continue;
    const nw = w * scale;
    if (nw > 0) out[c] = nw;
  }
  out[cashCode] = (out[cashCode] || 0) + cashPct;
  const s = Object.values(out).reduce((a, b) => a + b, 0);
  if (!(s > 0)) return { [cashCode]: 1 };
  return Object.fromEntries(Object.entries(out).map(([c, w]) => [c, w / s]));
}

/** 국면 헤지(실험): docs/EXPERIMENT_REGIME_HEDGE.md — sync with build_backtest.py */
const REGIME_HEDGE_MAX_PCT = 0.15;
const REGIME_HEDGE_INV = "114800";
const REGIME_HEDGE_FORBIDDEN_2X = new Set(["252670"]);
const REGIME_HEDGE_A = "069500";
const REGIME_HEDGE_B = "133690";

function regimeHedgeSignal(priceMap, asof, window = 200) {
  if (!priceMap[REGIME_HEDGE_A] || !priceMap[REGIME_HEDGE_B]) return false;
  const aOn = maRiskOn(priceMap[REGIME_HEDGE_A], asof, window);
  const bOn = maRiskOn(priceMap[REGIME_HEDGE_B], asof, window);
  return !aOn && !bOn;
}

function applyRegimeHedge(tw, hedgeOn, hedgeCode, hedgePct) {
  if (!hedgeOn) return { ...tw };
  const pct = Math.min(REGIME_HEDGE_MAX_PCT, Math.max(0, Number(hedgePct)));
  if (!(pct > 0)) return { ...tw };
  const scale = 1 - pct;
  const out = {};
  for (const [c, w] of Object.entries(tw)) {
    if (c === hedgeCode) continue;
    const nw = w * scale;
    if (nw > 0) out[c] = nw;
  }
  out[hedgeCode] = (out[hedgeCode] || 0) + pct;
  const s = Object.values(out).reduce((a, b) => a + b, 0);
  if (!(s > 0)) return { [hedgeCode]: 1 };
  return Object.fromEntries(Object.entries(out).map(([c, w]) => [c, w / s]));
}

function resolveRegimeHedgeCode(mode, cashCode, hedgeCode) {
  if ((mode || "inverse") === "cash") return cashCode || "153130";
  const code = hedgeCode || REGIME_HEDGE_INV;
  if (REGIME_HEDGE_FORBIDDEN_2X.has(code)) {
    throw new Error(`2X 인버스 ${code} 금지 (−1x ${REGIME_HEDGE_INV}만)`);
  }
  if (code !== REGIME_HEDGE_INV) {
    throw new Error(`인버스 헤지는 ${REGIME_HEDGE_INV}만 허용`);
  }
  return code;
}


// --- GOLDON (금 온/오프 슬리브): sync with agents/build_backtest.py ---
// Overlay order: base → invVol → maOverlay → regime → gold last (G1).
const GOLD_CODE = "411060";
const GOLD_CODE_FUTURES = "132030"; // long KRX gold futures (H)
const GOLD_CASH = "153130"; // fixed; NEVER 0072R0
const GOLD_COST = 0.001;
const GOLD_SLEEVE_DEFAULT = 0.15;
const GOLD_CODES_ALLOWED = ["411060", "132030", "139320", "319640"];

function clampGoldSleeve(pct) {
  const v = pct != null ? Number(pct) : GOLD_SLEEVE_DEFAULT;
  return Math.min(0.2, Math.max(0.1, Number.isFinite(v) ? v : GOLD_SLEEVE_DEFAULT));
}

function resolveGoldCode(code) {
  if (code == null || String(code).trim() === "") return GOLD_CODE;
  const c = String(code).trim().padStart(6, "0");
  return c;
}

function goldSignalOn(signalMonth, lookback, monthEndsCache, goldCode = GOLD_CODE) {
  const goldRet = lookbackReturn(goldCode, signalMonth, lookback, monthEndsCache);
  const cashRet = lookbackReturn(GOLD_CASH, signalMonth, lookback, monthEndsCache);
  if (goldRet == null || cashRet == null) return false;
  return goldRet > cashRet;
}

function applyGoldSleeve(tw, goldOn, sleevePct, goldCode = GOLD_CODE) {
  const sleeve = clampGoldSleeve(sleevePct);
  const restScale = 1 - sleeve;
  const rest = {};
  for (const [c, w] of Object.entries(tw)) {
    if (c === goldCode) continue;
    if (w > 0) rest[c] = (rest[c] || 0) + w;
  }
  const s = Object.values(rest).reduce((a, b) => a + b, 0);
  const out = {};
  if (s > 0) {
    for (const [c, w] of Object.entries(rest)) out[c] = (w / s) * restScale;
  } else {
    out[GOLD_CASH] = restScale;
  }
  const hold = goldOn ? goldCode : GOLD_CASH;
  out[hold] = (out[hold] || 0) + sleeve;
  const tot = Object.values(out).reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return { [GOLD_CASH]: 1 };
  return Object.fromEntries(Object.entries(out).filter(([, w]) => w > 0).map(([c, w]) => [c, w / tot]));
}

const BAND_PCT_DEFAULT = 0.05;
const BAND_PCT_MIN = 0.01;
const BAND_PCT_MAX = 0.1;

/** Mirror agents/build_backtest._clamp_band_pct */
function clampBandPct(bandPct) {
  let v = bandPct != null ? Number(bandPct) : BAND_PCT_DEFAULT;
  if (!Number.isFinite(v)) v = BAND_PCT_DEFAULT;
  return Math.min(BAND_PCT_MAX, Math.max(BAND_PCT_MIN, v));
}

/** Mirror agents/build_backtest._band_drift_exceeds */
function bandDriftExceeds(units, priceMap, d, value, targetTw, bandPct) {
  if (!(value > 0) || !(bandPct >= 0)) return false;
  const codes = new Set([...Object.keys(units || {}), ...Object.keys(targetTw || {})]);
  for (const c of codes) {
    let w = 0;
    if (units && units[c] != null) {
      const px = priceMap[c] && priceMap[c][d];
      if (px == null || !(px > 0)) continue;
      w = (units[c] * px) / value;
    }
    const t = targetTw && targetTw[c] != null ? Number(targetTw[c]) : 0;
    if (Math.abs(w - t) > bandPct + 1e-12) return true;
  }
  return false;
}


const TRADE_COST_DEFAULT = 0.001; // 0.1% = 10bps
const TRADE_COST_MIN = 0;
const TRADE_COST_MAX = 0.005; // 0.5% = 50bps

/** Mirror agents/build_backtest._clamp_trade_cost */
function clampTradeCost(rate) {
  let v = rate != null ? Number(rate) : TRADE_COST_DEFAULT;
  if (!Number.isFinite(v)) v = TRADE_COST_DEFAULT;
  return Math.min(TRADE_COST_MAX, Math.max(TRADE_COST_MIN, v));
}

/** Current portfolio weights from units (after MTM). */
function currentWeights(units, priceMap, d, value) {
  if (!(value > 0) || !units) return {};
  const out = {};
  for (const c of Object.keys(units)) {
    const px = priceMap[c] && priceMap[c][d];
    if (px == null || !(px > 0)) continue;
    out[c] = (units[c] * px) / value;
  }
  return out;
}

/** One-way turnover = 0.5 * Σ|w_new − w_old| */
function oneWayTurnover(wOld, wNew) {
  const codes = new Set([...Object.keys(wOld || {}), ...Object.keys(wNew || {})]);
  let s = 0;
  for (const c of codes) {
    s += Math.abs((wNew && wNew[c] != null ? Number(wNew[c]) : 0) - (wOld && wOld[c] != null ? Number(wOld[c]) : 0));
  }
  return 0.5 * s;
}

/**
 * TR 토글 영구 비활성. 가격 시뮬 시세가 이미 수정주가(분배금 세전 재투자 효과 포함)라
 * 별도 TR/분배 가산은 어떤 경우에도 이중 계산이 된다. 실제 분배금은 배당 현금흐름 모드에서만.
 */
function hasRealTrData() {
  return false;
}

/** Legacy flag probe (audit record; unused). */
function _legacyHasTrFlag() {
  const m = state.meta;
  if (!m) return false;
  if (m.hasTotalReturn === true || m.hasTR === true) return true;
  const etfs = m.etfs || [];
  return etfs.some((e) => e && (e.tr === true || e.hasTR === true || e.trCode || e.trSeries));
}

function updateTradeCostLabel() {
  const el = $("#tradeCostLabel");
  if (!el) return;
  const rate = clampTradeCost(state.tradeCost);
  const bps = Math.round(rate * 10000);
  const pctStr = (rate * 100).toFixed(2);
  el.textContent = `${pctStr}% (${bps}bps)`;
}

/**
 * Same-day: mark-to-market THEN rebalance.
 * Full rebalance ONLY on real rebalance dates (calendar Q/Y/M or band breach,
 * MOM-like monthly swaps, day 0).
 * DCA: on first trading day of each new month, add cash then BUY at current target
 * weights (no selling); on a calendar date the cash joins the full rebalance.
 * Monthly overlays (regime hedge / sleeveTrend / volTarget / GOLDON) on non-calendar
 * months: sleeve-only update — overlays re-applied to the drifted core (virtual core
 * book since last full rebalance), core keeps its relative drift.
 * Trading cost: value -= value × TO × rate (TO = one-way turnover of actual trades).
 * weighting invVol applied on rebalance days (and day 0).
 * maOverlay (maSignalFreq "monthly", default): month-start signal from the previous
 * month-end close (closes < YYYY-MM-01), independent of the calendar; first monthly
 * overlay (MA → regime → sleeveTrend → volTarget → GOLDON) on the drifting pre-MA core,
 * so a non-calendar flip moves only the risky part to/from cash (sleeve update).
 * maSignalFreq "rebal" = legacy (MA inside the core, only on full-rebalance dates).
 * Numbers are computed only here (and in agents/build_backtest.py).
 */
function backtest(
  weights,
  priceMap,
  start,
  end,
  rebalance,
  initialCapital = 1,
  monthlyContribution = 0,
  opts = {}
) {
  const codes = Object.keys(weights).filter((c) => weights[c] > 0);
  if (!codes.length) return { error: "ETF를 선택하세요." };
  if (rebalance === "XSMOM" && codes.length < 5) {
    return { error: "XS 모멘텀은 유니버스 5종 이상이 필요합니다." };
  }
  const total = codes.reduce((s, c) => s + weights[c], 0);
  const tw = Object.fromEntries(codes.map((c) => [c, weights[c] / total]));

  const lookback = Number(opts.lookback) >= 3 ? 3 : 1;
  const topN = Math.max(1, Number(opts.topN) || 3);
  const momCost = clampTradeCost(opts.cost != null ? opts.cost : TRADE_COST_DEFAULT);
  const weighting = opts.weighting === "invVol" ? "invVol" : "fixed";
  const volWindow = Math.max(2, Number(opts.volWindow) || 60);
  const maOverlay = !!opts.maOverlay;
  const maWindow = Math.max(2, Number(opts.maWindow) || 200);
  const cashCode = opts.cashCode || "153130";
  const maCashPct = opts.maCashPct != null ? Number(opts.maCashPct) : 1.0;
  const maFreq = normMaSignalFreq(opts.maSignalFreq);
  const maMonthly = maOverlay && maFreq === "monthly";
  const maInCore = maOverlay && !maMonthly;
  const regimeHedge = !!opts.regimeHedge;
  const regimeHedgeMode = opts.regimeHedgeMode === "cash" ? "cash" : "inverse";
  const regimeHedgePct = Math.min(
    REGIME_HEDGE_MAX_PCT,
    Math.max(0, opts.regimeHedgePct != null ? Number(opts.regimeHedgePct) : REGIME_HEDGE_MAX_PCT)
  );
  const goldOn = !!opts.goldOn;
  const goldSleeve = clampGoldSleeve(opts.goldSleevePct != null ? opts.goldSleevePct : GOLD_SLEEVE_DEFAULT);
  const goldLb = Number(opts.goldLookback) >= 3 ? 3 : 1;
  const goldHold = resolveGoldCode(opts.goldCode);
  const bandOnOpt = !!opts.bandOn;
  let hedgeCodeRes = null;
  if (regimeHedge) {
    try {
      hedgeCodeRes = resolveRegimeHedgeCode(regimeHedgeMode, cashCode, opts.regimeHedgeCode);
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }
  const volTargetOn = !!opts.volTarget;
  const volTargetPct = Math.max(0.01, Math.min(0.5, Number(opts.volTargetPct) || 0.1));
  const volTargetWindow = Math.max(5, Number(opts.volTargetWindow) || 60);
  const sleeveTrendOn = !!opts.sleeveTrend;
  const sleeveTrendMode = opts.sleeveTrendMode === "ma" ? "ma" : "abs";
  const sleeveTrendLb = Number(opts.sleeveTrendLookback) >= 3 ? 3 : 1;
  const etfFlags = opts.etfFlags || etfFlagsMap();
  const momLike =
    rebalance === "MOM" ||
    rebalance === "DMOM" ||
    rebalance === "MOM12_1" ||
    rebalance === "XSMOM";
  // Band: fixed-target modes only; MOM-like keep monthly calendar swaps.
  const bandActive = bandOnOpt && !momLike;
  const bandPctC = bandActive ? clampBandPct(opts.bandPct) : 0;
  const needCash =
    rebalance === "DMOM" ||
    maOverlay ||
    (regimeHedge && regimeHedgeMode === "cash") ||
    volTargetOn ||
    sleeveTrendOn;

  if (needCash && !priceMap[cashCode]) {
    return { error: `안전자산 ${cashCode} 시세가 없습니다.` };
  }
  if (goldOn) {
    if (!priceMap[goldHold]) return { error: `금 슬리브 신호용 ${goldHold} 시세가 없습니다.` };
    if (!priceMap[GOLD_CASH]) return { error: `금 슬리브 현금대리 ${GOLD_CASH} 시세가 없습니다.` };
  }
  if (maOverlay && !priceMap[BENCH]) {
    return { error: `벤치마크 ${BENCH} 시세가 없습니다.` };
  }
  if (regimeHedge) {
    if (!priceMap[REGIME_HEDGE_A] || !priceMap[REGIME_HEDGE_B]) {
      return { error: "국면 헤지 신호용 069500·133690 시세가 필요합니다." };
    }
    if (!priceMap[hedgeCodeRes]) {
      return { error: `국면 헤지 자산 ${hedgeCodeRes} 시세가 없습니다.` };
    }
  }

  const calendarCodes = [...codes];
  if (needCash && !calendarCodes.includes(cashCode)) calendarCodes.push(cashCode);
  if (regimeHedge) {
    for (const extra of [REGIME_HEDGE_A, REGIME_HEDGE_B, hedgeCodeRes]) {
      if (extra && !calendarCodes.includes(extra)) calendarCodes.push(extra);
    }
  }
  if (goldOn) {
    for (const extra of [goldHold, GOLD_CASH]) {
      if (!calendarCodes.includes(extra)) calendarCodes.push(extra);
    }
  }

  const sets = calendarCodes.map(
    (c) => new Set(Object.keys(priceMap[c] || {}).filter((d) => d >= start && d <= end))
  );
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  if (common.length < 20)
    return { error: "선택한 ETF의 공통 상장 기간이 너무 짧습니다. 기간을 줄이거나 종목을 바꿔보세요." };

  const monthEndsCodes = [...codes];
  if (rebalance === "DMOM" && !monthEndsCodes.includes(cashCode)) monthEndsCodes.push(cashCode);
  if (goldOn) {
    for (const extra of [goldHold, GOLD_CASH]) {
      if (!monthEndsCodes.includes(extra)) monthEndsCodes.push(extra);
    }
  }
  let monthEndsCache =
    momLike || goldOn || sleeveTrendOn
      ? Object.fromEntries(monthEndsCodes.map((c) => [c, monthEndCloses(priceMap[c])]))
      : {};
  if (sleeveTrendOn) {
    for (const c of [...codes, cashCode]) {
      if (!monthEndsCache[c] && priceMap[c]) monthEndsCache[c] = monthEndCloses(priceMap[c]);
    }
  }

  const q = (m) => Math.floor((Number(m) - 1) / 3);
  const isRebal = (prev, cur) => {
    if (rebalance === "N") return false;
    if (!prev) return true;
    const [py, pm] = prev.split("-"),
      [cy, cm] = cur.split("-");
    if (rebalance === "Y") return py !== cy;
    if (
      rebalance === "M" ||
      rebalance === "MOM" ||
      rebalance === "DMOM" ||
      rebalance === "MOM12_1" ||
      rebalance === "XSMOM"
    )
      return prev.slice(0, 7) !== cur.slice(0, 7);
    return py !== cy || q(pm) !== q(cm);
  };
  const isNewMonth = (prev, cur) => prev && prev.slice(0, 7) !== cur.slice(0, 7);

  let units = null,
    value = initialCapital,
    peak = initialCapital,
    mdd = 0,
    prev = null,
    prevValue = null;
  let totalInvested = initialCapital,
    contributions = 1;
  let activeCodes = [...codes];
  let currentTw = { ...tw };
  let prevHoldings = null;
  const momHoldings = [];
  const regimeLog = [];
  let lastRegime = null;
  const hedgeLog = [];
  let lastHedge = null;
  const goldLog = [];
  let lastGoldOn = null;
  let lastGoldHolding = null;
  let prevGoldState = null;
  let rebalCount = 0;
  let totalCostDrag = 0;
  const curve = [],
    rets = [];

  // MA signal: month-start state currently applied (monthly mode) + flip count
  let maState = null;
  let maSwitchCount = 0;

  // Monthly overlays (updated every new month; sleeve-only on non-calendar months)
  const monthlyOverlay = regimeHedge || goldOn || volTargetOn || sleeveTrendOn;
  // core base (post invVol; + MA only in "rebal" mode) at last full rebalance
  let coreTarget = { ...tw };
  let coreUnits = {}; // virtual core book (drifts with prices)
  let sleeveUpdateCount = 0;
  let dcaBuyCount = 0;

  function coreBase(d) {
    // Rebalance-date base: mode picks → invVol (→ MA overlay in "rebal" mode)
    let base;
    if (rebalance === "MOM") {
      [, base] = momentumPick(codes, priceMap, d.slice(0, 7), lookback, topN, monthEndsCache);
    } else if (rebalance === "MOM12_1") {
      [, base] = momentumPick12_1(codes, priceMap, d.slice(0, 7), topN, monthEndsCache);
    } else if (rebalance === "XSMOM") {
      [, base] = xsMomentumPick(codes, priceMap, d.slice(0, 7), lookback, topN, monthEndsCache);
    } else if (rebalance === "DMOM") {
      [, base] = dualMomentumPick(
        codes,
        priceMap,
        d.slice(0, 7),
        lookback,
        topN,
        monthEndsCache,
        cashCode
      );
    } else {
      base = { ...tw };
    }
    if (weighting === "invVol") {
      base = invVolWeights(Object.keys(base), priceMap, d, volWindow, base);
    }
    if (maInCore) {
      const [riskOn, sigD] = maSignal(priceMap[BENCH], d, maWindow);
      const newRegime = riskOn ? "on" : "off";
      if (lastRegime != null && newRegime !== lastRegime) maSwitchCount += 1;
      lastRegime = newRegime;
      regimeLog.push({ date: d, regime: lastRegime, signalDate: sigD });
      base = applyMaOverlay(base, riskOn, cashCode, maCashPct);
    }
    return Object.fromEntries(Object.entries(base).filter(([, w]) => w > 0));
  }

  function evalMaMonth(d) {
    // Monthly MA signal at month start (previous month-end close). Returns true on flip.
    const [riskOn, sigD] = maSignal(priceMap[BENCH], maMonthAsof(d), maWindow);
    const flipped = maState != null && riskOn !== maState;
    if (flipped) maSwitchCount += 1;
    maState = riskOn;
    lastRegime = riskOn ? "on" : "off";
    regimeLog.push({ date: d, regime: lastRegime, signalDate: sigD });
    return flipped;
  }

  function applyMonthlyOverlays(baseIn, d, log = true) {
    // (MA monthly →) regime hedge → sleeveTrend → volTarget → GOLDON (last)
    let base = { ...baseIn };
    if (maMonthly) base = applyMaOverlay(base, !!maState, cashCode, maCashPct);
    if (regimeHedge && hedgeCodeRes) {
      const hedgeOn = regimeHedgeSignal(priceMap, d, maWindow);
      if (log) {
        lastHedge = hedgeOn;
        hedgeLog.push({ date: d, hedge: hedgeOn });
      }
      base = applyRegimeHedge(base, hedgeOn, hedgeCodeRes, regimeHedgePct);
    }
    if (sleeveTrendOn) {
      base = applySleeveTrend(
        base,
        d.slice(0, 7),
        monthEndsCache,
        priceMap,
        d,
        cashCode,
        sleeveTrendMode,
        sleeveTrendLb,
        maWindow,
        etfFlags
      );
    }
    if (volTargetOn) {
      base = applyVolTarget(
        base,
        priceMap,
        d,
        volTargetPct,
        volTargetWindow,
        cashCode,
        etfFlags
      );
    }
    // GOLDON last so goldHold weight stays exactly 0 or sleevePct (G1)
    let goldState = null;
    if (goldOn) {
      goldState = goldSignalOn(d.slice(0, 7), goldLb, monthEndsCache, goldHold);
      base = applyGoldSleeve(base, goldState, goldSleeve, goldHold);
      if (log) {
        lastGoldOn = goldState;
        lastGoldHolding = goldState ? goldHold : GOLD_CASH;
        goldLog.push({
          date: d,
          month: d.slice(0, 7),
          on: goldState,
          holding: lastGoldHolding,
          weights: { ...base },
        });
      }
    }
    const active = Object.keys(base).filter((c) => base[c] > 0);
    return [base, active, goldState];
  }

  function targetWeights(d) {
    const core = coreBase(d);
    const [full, active, goldState] = applyMonthlyOverlays(core, d, true);
    return [core, full, active, goldState];
  }

  function resetCoreBook(d, v) {
    coreUnits = {};
    for (const [c, w] of Object.entries(coreTarget)) {
      if (w > 0) coreUnits[c] = (w * v) / priceMap[c][d];
    }
  }

  function coreValue(d) {
    let cv = 0;
    for (const [c, u] of Object.entries(coreUnits)) cv += u * priceMap[c][d];
    return cv;
  }

  function coreDriftWeights(d) {
    const cv = coreValue(d);
    if (!(cv > 0)) return { ...coreTarget };
    const out = {};
    for (const [c, u] of Object.entries(coreUnits)) {
      if (u > 0) out[c] = (u * priceMap[c][d]) / cv;
    }
    return out;
  }

  function coreAddCash(d, valuePre, contrib) {
    // Virtual core: rescale to pre-cash portfolio value, then buy cash at core target
    const cv = coreValue(d);
    if (cv > 0 && valuePre > 0) {
      const k = valuePre / cv;
      for (const c of Object.keys(coreUnits)) coreUnits[c] *= k;
    }
    for (const [c, w] of Object.entries(coreTarget)) {
      if (w > 0) coreUnits[c] = (coreUnits[c] || 0) + (contrib * w) / priceMap[c][d];
    }
  }

  for (const d of common) {
    if (!units) {
      let gState;
      if (maMonthly) evalMaMonth(d);
      [coreTarget, currentTw, activeCodes, gState] = targetWeights(d);
      units = Object.fromEntries(activeCodes.map((c) => [c, (currentTw[c] * value) / priceMap[c][d]]));
      resetCoreBook(d, value);
      prevHoldings = new Set(activeCodes);
      if (goldOn) prevGoldState = gState;
      if (momLike) {
        momHoldings.push({ month: d.slice(0, 7), codes: [...activeCodes], weights: { ...currentTw } });
      }
      value = activeCodes.reduce((s, c) => s + units[c] * priceMap[c][d], 0);
    } else {
      // 1) Mark to market
      value = activeCodes.reduce((s, c) => s + units[c] * priceMap[c][d], 0);
      if (prevValue != null && prevValue > 0) rets.push([d, value / prevValue - 1]);

      const newMonth = isNewMonth(prev, d);
      // Monthly MA signal (month start, previous month-end close) regardless of calendar
      const maFlip = maMonthly && newMonth ? evalMaMonth(d) : false;
      // Full rebalance ONLY on real rebalance dates (calendar Q/Y/M, MOM-like monthly,
      // or band breach below). Band mode ignores the calendar.
      let doFull = bandActive ? false : isRebal(prev, d);

      // 2) Monthly DCA cash inflow on first trading day of new month
      let contrib = 0;
      const valuePre = value;
      if (monthlyContribution > 0 && newMonth) {
        contrib = Number(monthlyContribution);
        value += contrib;
        totalInvested += contrib;
        contributions += 1;
      }

      // 3a) Non-rebalance month: sleeve-only overlay update and/or DCA buy.
      // Core holdings keep their relative drift (no reset to target weights).
      // MA alone updates its sleeve only on a flip (only the switched amount trades);
      // with other monthly overlays it is re-applied every month in the chain.
      const overlayMonth = newMonth && (monthlyOverlay || maFlip);
      if (!doFull && (contrib > 0 || overlayMonth)) {
        const wOld = currentWeights(units, priceMap, d, value);
        if (contrib > 0) coreAddCash(d, valuePre, contrib);
        let newUnits;
        if (overlayMonth) {
          const drifted = coreDriftWeights(d);
          const [sleeveTw, sleeveActive, gState] = applyMonthlyOverlays(drifted, d, true);
          // Full-target weights at current overlay state: DCA buys + band ref
          currentTw = applyMonthlyOverlays(coreTarget, d, false)[0];
          newUnits = {};
          for (const c of sleeveActive) newUnits[c] = (sleeveTw[c] * valuePre) / priceMap[c][d];
          sleeveUpdateCount += 1;
          if (goldOn) prevGoldState = gState;
        } else {
          newUnits = { ...units };
        }
        if (contrib > 0) {
          dcaBuyCount += 1;
          for (const [c, w] of Object.entries(currentTw)) {
            if (w > 0) newUnits[c] = (newUnits[c] || 0) + (contrib * w) / priceMap[c][d];
          }
        }
        // Unified cost on actual trades: TO = 0.5 × Σ|wNew − wOld|
        // (a pure cash buy costs 0.5 × contrib × rate, same as before).
        if (momCost > 0) {
          const wNew = currentWeights(newUnits, priceMap, d, value);
          const turnover = oneWayTurnover(wOld, wNew);
          if (turnover > 0) {
            const drag = value * turnover * momCost;
            totalCostDrag += drag;
            const k = 1 - turnover * momCost;
            for (const c of Object.keys(newUnits)) newUnits[c] *= k;
          }
        }
        units = Object.fromEntries(Object.entries(newUnits).filter(([, u]) => u > 0));
        activeCodes = Object.keys(units);
        prevHoldings = new Set(activeCodes);
        value = activeCodes.reduce((s, c) => s + units[c] * priceMap[c][d], 0);
      }

      // Band drift (after MTM / DCA / sleeve update): any |w-target| > band
      if (bandActive && !doFull && bandDriftExceeds(units, priceMap, d, value, currentTw, bandPctC)) {
        doFull = true;
      }

      // 3b) Full rebalance after MTM (+ optional cash)
      if (doFull) {
        rebalCount += 1;
        const wOld = currentWeights(units, priceMap, d, value);
        const [newCore, newTw, newActive, gState] = targetWeights(d);
        coreTarget = newCore;
        const newSet = new Set(newActive);
        // Unified turnover cost (calendar / band / MOM / gold via weight Δ):
        // drag = value × oneWayTurnover × costRate
        if (momCost > 0 && prevHoldings != null) {
          const turnover = oneWayTurnover(wOld, newTw);
          if (turnover > 0) {
            const drag = value * turnover * momCost;
            totalCostDrag += drag;
            value -= drag;
          }
        }
        if (goldOn) prevGoldState = gState;
        currentTw = newTw;
        activeCodes = newActive;
        units = Object.fromEntries(activeCodes.map((c) => [c, (currentTw[c] * value) / priceMap[c][d]]));
        resetCoreBook(d, value);
        prevHoldings = newSet;
        if (momLike) {
          momHoldings.push({ month: d.slice(0, 7), codes: [...activeCodes], weights: { ...currentTw } });
        }
        value = activeCodes.reduce((s, c) => s + units[c] * priceMap[c][d], 0);
      }
    }
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
    curve.push({
      d,
      v: value / initialCapital,
      ret: totalInvested > 0 ? value / totalInvested - 1 : 0,
    });
    prev = d;
    prevValue = value;
  }

  // Calendar yearly: lump = last/prior-year-end (or start); DCA = compound daily MTM TWR
  const yearly = {};
  if (monthlyContribution > 0) {
    const byYRets = {};
    for (const [d, r] of rets) (byYRets[d.slice(0, 4)] ||= []).push(r);
    for (const [y, rs] of Object.entries(byYRets)) {
      let acc = 1;
      for (const r of rs) acc *= 1 + r;
      yearly[y] = acc - 1;
    }
    for (const { d } of curve) if (yearly[d.slice(0, 4)] == null) yearly[d.slice(0, 4)] = 0;
  } else {
    const lastByY = {};
    for (const { d, v } of curve) lastByY[d.slice(0, 4)] = v;
    const yearsSorted = Object.keys(lastByY).sort();
    const firstPoint = curve[0].v;
    let prevEnd = null;
    for (const y of yearsSorted) {
      const last = lastByY[y];
      const base = prevEnd == null ? firstPoint : prevEnd;
      yearly[y] = last / base - 1;
      prevEnd = last;
    }
  }

  const days = curve.length - 1,
    years = days / 252;
  const finalValue = prevValue;
  const totalRet = finalValue / totalInvested - 1;
  const cagr = years > 0 ? Math.pow(finalValue / totalInvested, 1 / years) - 1 : 0;
  const retVals = rets.map(([, r]) => r);
  const mean = retVals.reduce((a, b) => a + b, 0) / (retVals.length || 1);
  const variance =
    retVals.reduce((a, b) => a + (b - mean) ** 2, 0) / (retVals.length > 1 ? retVals.length - 1 : 1);
  const std = Math.sqrt(variance),
    vol = std * Math.sqrt(252),
    rf = 0.03 / 252;
  const ex = retVals.map((r) => r - rf);
  const meanEx = ex.reduce((a, b) => a + b, 0) / (ex.length || 1);
  const sharpe = std ? (meanEx / std) * Math.sqrt(252) : 0;
  const yvals = Object.values(yearly);
  return {
    start: curve[0].d,
    end: curve.at(-1).d,
    days,
    years,
    totalRet,
    cagr,
    mdd,
    vol,
    sharpe,
    yearly,
    curve,
    bestYear: yvals.length ? Math.max(...yvals) : null,
    worstYear: yvals.length ? Math.min(...yvals) : null,
    weights: currentTw,
    codes: activeCodes,
    totalInvested,
    finalValue,
    contributions,
    initialCapital,
    monthlyContribution,
    momHoldings: momLike ? momHoldings : null,
    lastRegime: maOverlay ? lastRegime : null,
    regimeLog: maOverlay ? regimeLog : null,
    hedgeActive: regimeHedge ? lastHedge : null,
    hedgeLog: regimeHedge ? hedgeLog : null,
    goldActive: goldOn ? lastGoldOn : null,
    goldHolding: goldOn ? lastGoldHolding : null,
    goldLog: goldOn ? goldLog : null,
    rebalCount,
    sleeveUpdateCount,
    dcaBuyCount,
    maSwitchCount: maOverlay ? maSwitchCount : 0,
    maSignalFreq: maOverlay ? maFreq : null,
    bandApplied: bandActive,
    bandPct: bandActive ? bandPctC : null,
    tradeCost: momCost,
    totalCostDrag,
  };
}



/** Mirror agents/build_backtest.compute_drawdown — numbers only. */
function computeDrawdown(curve, episodeThreshold = -0.05) {
  const pairs = (curve || []).map((p) =>
    Array.isArray(p) ? [p[0], Number(p[1])] : [p.d, Number(p.v)]
  );
  if (!pairs.length) {
    return {
      series: [],
      maxDD: 0,
      peakDate: null,
      troughDate: null,
      recoveryDate: null,
      underwaterDays: 0,
      episodes: [],
    };
  }

  const series = [];
  let peak = pairs[0][1];
  let peakDate = pairs[0][0];
  let maxDd = 0;
  let maxPeakDate = peakDate;
  let maxTroughDate = peakDate;
  let maxPeakValue = peak;

  const episodes = [];
  let epActive = false;
  let epPeakDate = null;
  let epTroughDate = null;
  let epTroughDd = 0;

  for (const [d, v] of pairs) {
    if (v > peak) {
      peak = v;
      peakDate = d;
    }
    let dd = peak > 0 ? v / peak - 1 : 0;
    if (dd > 0) dd = 0;
    series.push({ d, dd });

    if (dd < maxDd) {
      maxDd = dd;
      maxPeakDate = peakDate;
      maxTroughDate = d;
      maxPeakValue = peak;
    }

    if (!epActive) {
      if (dd < 0) {
        epActive = true;
        epPeakDate = peakDate;
        epTroughDate = d;
        epTroughDd = dd;
      }
    } else {
      if (dd < epTroughDd) {
        epTroughDd = dd;
        epTroughDate = d;
      }
      if (dd >= 0 || Math.abs(dd) < 1e-15) {
        if (epTroughDd <= episodeThreshold) {
          episodes.push({
            peakDate: epPeakDate,
            troughDate: epTroughDate,
            recoveryDate: d,
            depth: epTroughDd,
          });
        }
        epActive = false;
        epPeakDate = null;
        epTroughDate = null;
        epTroughDd = 0;
      }
    }
  }

  if (epActive && epTroughDd <= episodeThreshold) {
    episodes.push({
      peakDate: epPeakDate,
      troughDate: epTroughDate,
      recoveryDate: null,
      depth: epTroughDd,
    });
  }

  let recoveryDate = null;
  if (maxDd < 0 && maxPeakValue > 0) {
    let pastTrough = false;
    for (const [d, v] of pairs) {
      if (d === maxTroughDate) {
        pastTrough = true;
        continue;
      }
      if (pastTrough && v >= maxPeakValue) {
        recoveryDate = d;
        break;
      }
    }
  }

  const dateIndex = Object.fromEntries(pairs.map(([d], i) => [d, i]));
  const startI = dateIndex[maxPeakDate] ?? 0;
  let endI;
  if (recoveryDate != null) endI = dateIndex[recoveryDate];
  else endI = maxDd < 0 ? pairs.length - 1 : startI;
  const underwaterDays = maxDd < 0 ? Math.max(0, endI - startI) : 0;

  return {
    series,
    maxDD: maxDd,
    peakDate: maxDd < 0 ? maxPeakDate : pairs[0][0],
    troughDate: maxDd < 0 ? maxTroughDate : pairs[0][0],
    recoveryDate,
    underwaterDays,
    episodes,
  };
}

/** Mirror agents/build_backtest.rolling_cagr — numbers only. */
function rollingCagr(curve, window = 756) {
  const pairs = (curve || []).map((p) =>
    Array.isArray(p) ? [p[0], Number(p[1])] : [p.d, Number(p.v)]
  );
  const n = pairs.length;
  if (window <= 0 || n <= window) {
    return { series: [], min: null, median: null, max: null, window };
  }
  const series = [];
  const cagrs = [];
  const exp = 252 / window;
  for (let t = window; t < n; t++) {
    const v0 = pairs[t - window][1];
    const v1 = pairs[t][1];
    if (v0 <= 0 || v1 <= 0) continue;
    const cagr = Math.pow(v1 / v0, exp) - 1;
    series.push({ d: pairs[t][0], cagr });
    cagrs.push(cagr);
  }
  if (!cagrs.length) {
    return { series: [], min: null, median: null, max: null, window };
  }
  const sorted = [...cagrs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    series,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    window,
  };
}

/** Mirror agents/build_backtest._sensitivity_calendar_codes — numbers only. */
function sensitivityCalendarCodes(weights, cfg) {
  const codes = Object.keys(weights).filter((c) => weights[c] > 0);
  const rebalance = cfg.rebalance || "Q";
  const cashCode = cfg.cashCode || "153130";
  const needCash =
    rebalance === "DMOM" ||
    !!cfg.maOverlay ||
    (!!cfg.regimeHedge && cfg.regimeHedgeMode === "cash") ||
    !!cfg.volTarget ||
    !!cfg.sleeveTrend;
  const out = [...codes];
  if (needCash && !out.includes(cashCode)) out.push(cashCode);
  if (cfg.regimeHedge) {
    const hedge =
      cfg.regimeHedgeMode === "cash" ? cashCode : cfg.regimeHedgeCode || "114800";
    for (const extra of [REGIME_HEDGE_A || "069500", REGIME_HEDGE_B || "133690", hedge]) {
      if (extra && !out.includes(extra)) out.push(extra);
    }
  }
  if (cfg.goldOn) {
    const g = resolveGoldCode(cfg.goldCode);
    for (const extra of [g, GOLD_CASH]) {
      if (!out.includes(extra)) out.push(extra);
    }
  }
  return out;
}

/** Mirror agents/build_backtest._common_dates_for_codes. */
function commonDatesForCodes(codes, priceMap, end) {
  const sets = codes.map(
    (c) => new Set(Object.keys(priceMap[c] || {}).filter((d) => d <= end))
  );
  if (!sets.length) return [];
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  return common;
}

/** Mirror agents/build_backtest._month_first_candidates. */
function monthFirstCandidates(common, minDays = SENSITIVITY_MIN_DAYS) {
  if (!common.length) return [];
  const firstByYm = {};
  for (const d of common) {
    const ym = d.slice(0, 7);
    if (!firstByYm[ym]) firstByYm[ym] = d;
  }
  const n = common.length;
  const idx = Object.fromEntries(common.map((d, i) => [d, i]));
  const out = [];
  for (const ym of Object.keys(firstByYm).sort()) {
    const d0 = firstByYm[ym];
    const i0 = idx[d0];
    if (n - 1 - i0 >= minDays) out.push({ ym, d0 });
  }
  return out;
}

/** Mirror agents/build_backtest._subsample_starts. */
function subsampleStarts(candidates, maxStarts = SENSITIVITY_MAX_STARTS) {
  if (candidates.length <= maxStarts) return { selected: candidates, mode: "monthly" };
  if (maxStarts >= 12) {
    return { selected: candidates.slice(-maxStarts), mode: "monthly_recent" };
  }
  const quarterly = candidates.filter((c) => [1, 4, 7, 10].includes(Number(c.ym.slice(5, 7))));
  if (quarterly.length <= maxStarts && quarterly.length >= 2) {
    return { selected: quarterly.slice(-maxStarts), mode: "quarterly" };
  }
  const yearly = candidates.filter((c) => c.ym.endsWith("-01"));
  if (yearly.length <= maxStarts && yearly.length >= 2) {
    return { selected: yearly.slice(-maxStarts), mode: "yearly" };
  }
  const n = candidates.length;
  if (maxStarts <= 1) return { selected: [candidates[n - 1]], mode: "sampled" };
  const idxs = [
    ...new Set(
      Array.from({ length: maxStarts }, (_, i) => Math.round((i * (n - 1)) / (maxStarts - 1)))
    ),
  ].sort((a, b) => a - b);
  return { selected: idxs.map((i) => candidates[i]), mode: "sampled" };
}

/**
 * Mirror agents/build_backtest.start_date_sensitivity — sync, numbers only.
 * Prefer runSensitivityAsync in UI so the page does not freeze.
 */
function startDateSensitivity(weights, priceMap, end, rebalance, initial, monthly, opts, limits) {
  const maxStarts = (limits && limits.maxStarts) || SENSITIVITY_MAX_STARTS;
  const minDays = (limits && limits.minDays) || SENSITIVITY_MIN_DAYS;
  const cfg = { ...(opts || {}), rebalance };
  const cal = sensitivityCalendarCodes(weights, cfg);
  const missing = cal.filter((c) => !priceMap[c]);
  if (missing.length) {
    return {
      error: `시세 없음: ${missing.join(", ")}`,
      end,
      cells: [],
      mode: null,
      candidateCount: 0,
      runCount: 0,
    };
  }
  const common = commonDatesForCodes(cal, priceMap, end);
  if (common.length < minDays + 1) {
    return {
      error: "공통 거래일이 너무 짧습니다.",
      end,
      cells: [],
      mode: null,
      candidateCount: 0,
      runCount: 0,
    };
  }
  const fixedEnd = common[common.length - 1];
  const candidates = monthFirstCandidates(common, minDays);
  const { selected, mode } = subsampleStarts(candidates, maxStarts);
  const cells = [];
  for (const { ym, d0 } of selected) {
    const s = backtest(weights, priceMap, d0, fixedEnd, rebalance, initial, monthly, opts || {});
    if (s.error) {
      cells.push({
        ym,
        year: Number(ym.slice(0, 4)),
        month: Number(ym.slice(5, 7)),
        start: d0,
        end: fixedEnd,
        cagr: null,
        mdd: null,
        days: 0,
        error: s.error,
      });
      continue;
    }
    cells.push({
      ym,
      year: Number(ym.slice(0, 4)),
      month: Number(ym.slice(5, 7)),
      start: s.start,
      end: s.end,
      cagr: s.cagr,
      mdd: s.mdd,
      days: s.days,
      error: null,
    });
  }
  const years = [...new Set(cells.map((c) => c.year))].sort((a, b) => a - b);
  return {
    error: null,
    end: fixedEnd,
    cells,
    mode,
    candidateCount: candidates.length,
    runCount: selected.length,
    years,
    minDays,
    maxStarts,
  };
}

function destroyExtraCharts() {
  if (state.ddChart) {
    state.ddChart.destroy();
    state.ddChart = null;
  }
  if (state.rollingChart) {
    state.rollingChart.destroy();
    state.rollingChart = null;
  }
  if (state.compareChart) {
    state.compareChart.destroy();
    state.compareChart = null;
  }
}

function renderDrawdownCard(dd, benchDd) {
  if (!dd) return "";
  const rec = dd.recoveryDate || "미회복";
  return `<div class="card pad dd-card"><div class="section-title">수중 낙폭 (Underwater)</div>
    <div class="dd-stats">
      <div><div class="label">최대낙폭</div><div class="val neg">${pct(dd.maxDD)}</div></div>
      <div><div class="label">고점일</div><div class="val">${dd.peakDate || "—"}</div></div>
      <div><div class="label">저점일</div><div class="val">${dd.troughDate || "—"}</div></div>
      <div><div class="label">회복일</div><div class="val">${rec}</div></div>
      <div><div class="label">수중 일수</div><div class="val">${dd.underwaterDays}일</div></div>
    </div>
    <div class="dd-chart-wrap"><canvas id="ddCurve"></canvas></div>
    <div class="warn">고점 대비 낙폭 · 거래일 기준 · 벤치마크는 점선 · 과거 관측값</div>
  </div>`;
}

function renderRollingCard() {
  const keys = Object.keys(ROLLING_WINDOWS);
  const chips = keys
    .map(
      (k) =>
        `<button type="button" class="chip${state.rollingWindow === k ? " active" : ""}" data-roll="${k}">${k}</button>`
    )
    .join("");
  return `<div class="card pad rolling-card"><div class="section-title">롤링 연환산 수익률</div>
    <div class="rolling-toolbar">
      <div class="rolling-chips" id="rollingChips">${chips}</div>
      <div class="rolling-stats" id="rollingStats"></div>
    </div>
    <div class="rolling-chart-wrap"><canvas id="rollingCurve"></canvas></div>
    <div class="warn" id="rollingNote">창 길이만큼의 거래일이 쌓인 뒤부터 표시 · 과거 관측값</div>
  </div>`;
}

function fmtPctTooltip(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return sign + Number(v).toFixed(1) + "%";
}

function drawDrawdownChart(dd, benchDd) {
  const ctx = document.getElementById("ddCurve");
  if (!ctx) return;
  if (state.ddChart) state.ddChart.destroy();
  const labels = dd.series.map((p) => p.d);
  const port = dd.series.map((p) => p.dd * 100);
  const bmap = Object.fromEntries((benchDd?.series || []).map((p) => [p.d, p.dd]));
  const ben = dd.series.map((p) => (bmap[p.d] ?? 0) * 100);
  state.ddChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "포트폴리오 낙폭",
          data: port,
          borderColor: "#ff6b7a",
          backgroundColor: "rgba(255,107,122,.22)",
          fill: true,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.6,
        },
        {
          label: "KODEX 200",
          data: ben,
          borderColor: "#8b9aab",
          backgroundColor: "transparent",
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.2,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#8b9aab" } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtPctTooltip(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#667687", maxTicksLimit: 8 }, grid: { color: "rgba(39,49,64,.45)" } },
        y: {
          ticks: {
            color: "#667687",
            callback: (v) => v + "%",
          },
          grid: { color: "rgba(39,49,64,.45)" },
          max: 0,
        },
      },
    },
  });
}

function updateRollingStats(roll) {
  const host = $("#rollingStats");
  const note = $("#rollingNote");
  if (!host) return;
  if (!roll.series.length) {
    host.innerHTML = "";
    if (note)
      note.textContent =
        "선택한 창보다 공통 거래일이 짧아 롤링 수익률을 계산할 수 없습니다.";
    return;
  }
  if (note)
    note.textContent = `창 ${roll.window}거래일 · 관측 ${roll.series.length}개 · 과거 관측값`;
  host.innerHTML = [
    ["최소", roll.min],
    ["중앙", roll.median],
    ["최대", roll.max],
  ]
    .map(
      ([k, v]) =>
        `<span class="chip"><span class="k">${k}</span><span class="${cls(v)}">${pct(v)}</span></span>`
    )
    .join("");
}

function drawRollingChart(curve, windowKey) {
  const ctx = document.getElementById("rollingCurve");
  if (!ctx) return;
  const window = ROLLING_WINDOWS[windowKey] || 756;
  const roll = rollingCagr(curve, window);
  updateRollingStats(roll);
  if (state.rollingChart) {
    state.rollingChart.destroy();
    state.rollingChart = null;
  }
  if (!roll.series.length) return;
  const labels = roll.series.map((p) => p.d);
  const data = roll.series.map((p) => p.cagr * 100);
  state.rollingChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `롤링 CAGR (${windowKey})`,
          data,
          borderColor: "#f0c27a",
          backgroundColor: "rgba(240,194,122,.12)",
          fill: true,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#8b9aab" } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtPctTooltip(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#667687", maxTicksLimit: 8 }, grid: { color: "rgba(39,49,64,.45)" } },
        y: {
          ticks: {
            color: "#667687",
            callback: (v) => v + "%",
          },
          grid: { color: "rgba(39,49,64,.45)" },
        },
      },
    },
  });
}

function wireRollingChips() {
  const host = $("#rollingChips");
  if (!host) return;
  host.querySelectorAll("[data-roll]").forEach((btn) => {
    btn.onclick = () => {
      state.rollingWindow = btn.getAttribute("data-roll");
      host.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      if (state.lastPortCurve) drawRollingChart(state.lastPortCurve, state.rollingWindow);
    };
  });
}



/* ===== Batch 6: 시작일 민감도 히트맵 ===== */

function modeLabelKo(mode) {
  return (
    {
      monthly: "매월 시작",
      monthly_recent: "최근 구간 매월 시작",
      quarterly: "분기 시작",
      yearly: "연초 시작",
      sampled: "표본 시작",
    }[mode] || mode || "—"
  );
}

function heatColorCagr(v, absMax) {
  if (v == null || Number.isNaN(v)) return "rgba(39,49,64,.35)";
  const m = absMax > 0 ? absMax : 0.2;
  const t = Math.max(-1, Math.min(1, v / m));
  if (t >= 0) {
    const a = 0.15 + 0.55 * t;
    return `rgba(125,211,192,${a.toFixed(3)})`;
  }
  const a = 0.15 + 0.55 * -t;
  return `rgba(255,107,122,${a.toFixed(3)})`;
}

function heatColorMdd(v, minMdd) {
  if (v == null || Number.isNaN(v)) return "rgba(39,49,64,.35)";
  // v ≤ 0; deeper red for worse MDD
  const floor = minMdd < 0 ? minMdd : -0.5;
  const t = floor < 0 ? Math.min(1, v / floor) : 0; // 0..1
  const a = 0.12 + 0.65 * t;
  return `rgba(255,107,122,${a.toFixed(3)})`;
}

function sensitivityAbsMax(cells, metric) {
  if (metric === "mdd") {
    let mn = 0;
    for (const c of cells) {
      if (c.mdd != null && c.mdd < mn) mn = c.mdd;
    }
    return mn;
  }
  let mx = 0;
  for (const c of cells) {
    if (c.cagr != null && Math.abs(c.cagr) > mx) mx = Math.abs(c.cagr);
  }
  return mx || 0.2;
}

function renderSensitivityCard(partial) {
  const res = partial || state.sensitivityResult;
  const running = state.sensitivityRunning;
  const metric = state.sensitivityMetric || "cagr";
  let body = "";
  if (running && (!res || !res.cells || !res.cells.length)) {
    body = `<div class="sens-progress" id="sensProgress"><div class="sens-bar" style="width:2%"></div></div>
      <p class="muted-note">시작월별 백테스트 계산 중…</p>`;
  } else if (res && res.error) {
    body = `<div class="warn">${res.error}</div>`;
  } else if (res && res.cells && res.cells.length) {
    const byYm = Object.fromEntries(res.cells.map((c) => [c.ym, c]));
    const years = (res.years && res.years.length
      ? res.years
      : [...new Set(res.cells.map((c) => c.year))]
    ).slice().sort((a, b) => a - b);
    const scale = sensitivityAbsMax(res.cells, metric);
    const head = `<tr><th>연도</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}</th>`).join("")}</tr>`;
    const rows = years
      .map((y) => {
        const cells = Array.from({ length: 12 }, (_, i) => {
          const ym = `${y}-${String(i + 1).padStart(2, "0")}`;
          const c = byYm[ym];
          if (!c || c.error || (metric === "cagr" ? c.cagr == null : c.mdd == null)) {
            return `<td class="sens-empty" title="${ym}">·</td>`;
          }
          const val = metric === "mdd" ? c.mdd : c.cagr;
          const bg =
            metric === "mdd" ? heatColorMdd(val, scale) : heatColorCagr(val, scale);
          const title = `${c.start}~${c.end} · CAGR ${pct(c.cagr)} · MDD ${pct(c.mdd)} · ${c.days}일`;
          return `<td class="sens-cell" style="background:${bg}" title="${title}"><span>${pct(val, 1)}</span></td>`;
        }).join("");
        return `<tr><th>${y}</th>${cells}</tr>`;
      })
      .join("");
    const progress =
      running
        ? `<div class="sens-progress" id="sensProgress"><div class="sens-bar" id="sensBar" style="width:${Math.min(99, ((res.cells.length / (res.runCount || 1)) * 100)).toFixed(0)}%"></div></div>`
        : "";
    body = `${progress}
      <div class="sens-toolbar">
        <div class="rolling-chips" id="sensMetricChips">
          <button type="button" class="chip${metric === "cagr" ? " active" : ""}" data-sens-metric="cagr">CAGR</button>
          <button type="button" class="chip${metric === "mdd" ? " active" : ""}" data-sens-metric="mdd">MDD</button>
        </div>
        <div class="sens-meta">${modeLabelKo(res.mode)} · ${res.runCount}/${res.candidateCount}회 · 종료 ${res.end}</div>
      </div>
      <div class="sens-wrap"><table class="sens-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
      <div class="warn">같은 설정·고정 종료일에서 시작월만 바꾼 과거 시뮬입니다. 격자 색은 ${
        metric === "mdd" ? "MDD(낙폭)" : "연환산 수익률(CAGR)"
      } 기준입니다. 과거≠미래 · 투자 자문 아님.</div>`;
  } else {
    body = `<p class="muted-note">버튼을 누르면 현재 포트 설정으로 시작월별 종료창 CAGR·MDD를 계산합니다. 자동 실행하지 않습니다.</p>`;
  }
  return `<div class="card pad sens-card" id="sensCard">
    <div class="section-title">시작일 민감도 히트맵</div>
    <div class="btn-row sens-actions">
      <button type="button" class="primary" id="btnSensitivity" ${running ? "disabled" : ""}>${
        running ? "계산 중…" : "민감도 보기"
      }</button>
    </div>
    <div id="sensBody">${body}</div>
  </div>`;
}

function wireSensitivityCard() {
  const btn = $("#btnSensitivity");
  if (btn) {
    btn.onclick = () => {
      runSensitivityAsync().catch((err) => {
        state.sensitivityRunning = false;
        const body = $("#sensBody");
        if (body) body.innerHTML = `<div class="warn">${String(err.message || err)}</div>`;
        btn.disabled = false;
        btn.textContent = "민감도 보기";
      });
    };
  }
  const chips = $("#sensMetricChips");
  if (chips) {
    chips.querySelectorAll("[data-sens-metric]").forEach((el) => {
      el.onclick = () => {
        state.sensitivityMetric = el.getAttribute("data-sens-metric");
        const host = $("#sensCard");
        if (host) {
          const parent = host.parentElement;
          const html = renderSensitivityCard();
          host.outerHTML = html;
          wireSensitivityCard();
        }
      };
    });
  }
}

function buildSensitivityOptsFromState() {
  return {
    lookback: state.momLookback,
    topN: state.momTopN,
    cost: clampTradeCost(state.tradeCost),
    weighting: state.weighting,
    volWindow: state.volWindow,
    maOverlay: state.maOverlay,
    maWindow: state.maWindow,
    maSignalFreq: normMaSignalFreq(state.maSignalFreq),
    cashCode: state.cashCode || "153130",
    maCashPct: state.maCashPct,
    regimeHedge: state.regimeHedge,
    regimeHedgeMode: state.regimeHedgeMode,
    regimeHedgePct: Math.min(0.15, Math.max(0, Number(state.regimeHedgePct) || 0.15)),
    regimeHedgeCode: state.regimeHedgeCode || "114800",
    goldOn: state.goldOn,
    goldSleevePct: clampGoldSleeve(state.goldSleevePct),
    goldLookback: state.goldLookback,
    goldCode: resolveGoldCode(state.goldCode),
    bandOn: !!state.bandOn,
    bandPct: clampBandPct(state.bandPct),
    volTarget: !!state.volTarget,
    volTargetPct: Math.max(0.01, Math.min(0.5, Number(state.volTargetPct) || 0.1)),
    volTargetWindow: Math.max(5, Number(state.volTargetWindow) || 60),
    sleeveTrend: !!state.sleeveTrend,
    sleeveTrendMode: state.sleeveTrendMode === "ma" ? "ma" : "abs",
    sleeveTrendLookback: Number(state.sleeveTrendLookback) >= 3 ? 3 : 1,
    etfFlags: etfFlagsMap(),
  };
}

function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runSensitivityAsync() {
  const pack = state.lastRun;
  if (!pack || !pack.result || pack.result.error) {
    throw new Error("먼저 백테스트를 실행하세요.");
  }
  const token = ++state.sensitivityToken;
  state.sensitivityRunning = true;
  state.sensitivityResult = null;
  const btn = $("#btnSensitivity");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "계산 중…";
  }
  const body = $("#sensBody");
  if (body) {
    body.innerHTML = `<div class="sens-progress"><div class="sens-bar" id="sensBar" style="width:2%"></div></div>
      <p class="muted-note" id="sensProgNote">시작월별 백테스트 준비 중…</p>`;
  }

  const picks = pack.picks;
  const weights = Object.fromEntries(picks);
  const end = pack.result.end;
  const rebalance = state.rebalance;
  const initial = state.dcaOn ? state.initialCapital : 1;
  const monthly = state.dcaOn ? state.monthlyAmount : 0;
  const opts = buildSensitivityOptsFromState();
  // Same price map as last run (TR if enabled)
  const codes = picks.map(([c]) => c);
  const needCash =
    rebalance === "DMOM" || state.maOverlay || (state.regimeHedge && state.regimeHedgeMode === "cash");
  const loadCodes = [
    ...new Set([
      ...codes,
      BENCH,
      ...(needCash ? [state.cashCode || "153130"] : []),
      ...(state.regimeHedge
        ? [
            REGIME_HEDGE_B,
            state.regimeHedgeMode === "cash"
              ? state.cashCode || "153130"
              : state.regimeHedgeCode || "114800",
          ]
        : []),
      ...(state.goldOn ? [resolveGoldCode(state.goldCode), GOLD_CASH] : []),
    ]),
  ];
  const useTr = state.totalReturn && hasRealTrData();
  const priceMap = useTr ? buildTotalReturnPrices(state.prices, loadCodes) : state.prices;

  const cfg = { ...opts, rebalance };
  const cal = sensitivityCalendarCodes(weights, cfg);
  const common = commonDatesForCodes(cal, priceMap, end);
  if (common.length < SENSITIVITY_MIN_DAYS + 1) {
    state.sensitivityRunning = false;
    state.sensitivityResult = { error: "공통 거래일이 너무 짧습니다.", cells: [], end };
    const card = $("#sensCard");
    if (card) {
      card.outerHTML = renderSensitivityCard();
      wireSensitivityCard();
    }
    return;
  }
  const fixedEnd = common[common.length - 1];
  const candidates = monthFirstCandidates(common, SENSITIVITY_MIN_DAYS);
  const { selected, mode } = subsampleStarts(candidates, SENSITIVITY_MAX_STARTS);
  const cells = [];
  const yearsSet = new Set();

  for (let i = 0; i < selected.length; i++) {
    if (token !== state.sensitivityToken) return; // cancelled by newer run / re-backtest
    const { ym, d0 } = selected[i];
    const s = backtest(weights, priceMap, d0, fixedEnd, rebalance, initial, monthly, opts);
    if (s.error) {
      cells.push({
        ym,
        year: Number(ym.slice(0, 4)),
        month: Number(ym.slice(5, 7)),
        start: d0,
        end: fixedEnd,
        cagr: null,
        mdd: null,
        days: 0,
        error: s.error,
      });
    } else {
      cells.push({
        ym,
        year: Number(ym.slice(0, 4)),
        month: Number(ym.slice(5, 7)),
        start: s.start,
        end: s.end,
        cagr: s.cagr,
        mdd: s.mdd,
        days: s.days,
        error: null,
      });
      yearsSet.add(Number(ym.slice(0, 4)));
    }
    if (i % SENSITIVITY_CHUNK === SENSITIVITY_CHUNK - 1 || i === selected.length - 1) {
      const partial = {
        error: null,
        end: fixedEnd,
        cells: cells.slice(),
        mode,
        candidateCount: candidates.length,
        runCount: selected.length,
        years: [...yearsSet].sort((a, b) => a - b),
        minDays: SENSITIVITY_MIN_DAYS,
        maxStarts: SENSITIVITY_MAX_STARTS,
      };
      state.sensitivityResult = partial;
      const bar = $("#sensBar");
      const note = $("#sensProgNote");
      const pctDone = ((i + 1) / selected.length) * 100;
      if (bar) bar.style.width = `${pctDone.toFixed(0)}%`;
      if (note)
        note.textContent = `계산 중 ${i + 1}/${selected.length} · ${modeLabelKo(mode)}`;
      // Refresh heatmap progressively after a few chunks
      if (i >= SENSITIVITY_CHUNK * 2 || i === selected.length - 1) {
        const card = $("#sensCard");
        if (card) {
          card.outerHTML = renderSensitivityCard(partial);
          wireSensitivityCard();
        }
      }
      await yieldToUI();
    }
  }

  if (token !== state.sensitivityToken) return;
  state.sensitivityRunning = false;
  state.sensitivityResult = {
    error: null,
    end: fixedEnd,
    cells,
    mode,
    candidateCount: candidates.length,
    runCount: selected.length,
    years: [...yearsSet].sort((a, b) => a - b),
    minDays: SENSITIVITY_MIN_DAYS,
    maxStarts: SENSITIVITY_MAX_STARTS,
  };
  const card = $("#sensCard");
  if (card) {
    card.outerHTML = renderSensitivityCard();
    wireSensitivityCard();
  }
}

function renderMomHoldings(rows) {
  if (!rows || !rows.length) return "";
  const meta = Object.fromEntries((state.meta?.etfs || []).map((e) => [e.code, e.name]));
  const slice = rows.slice(-24);
  const body = slice
    .map((h) => {
      const names = (h.codes || [])
        .map((c) => {
          const w = h.weights && h.weights[c] != null ? ` ${(h.weights[c] * 100).toFixed(0)}%` : "";
          return `${meta[c] || c}${w}`;
        })
        .join(", ");
      return `<tr><td>${h.month}</td><td>${(h.codes || []).join(", ")}</td><td>${names}</td></tr>`;
    })
    .join("");
  const dual = state.rebalance === "DMOM";
  const title =
    state.rebalance === "DMOM"
      ? "듀얼 모멘텀"
      : state.rebalance === "MOM12_1"
        ? "12-1 스킵 모멘텀"
        : state.rebalance === "XSMOM"
          ? "XS 잔차 모멘텀"
          : "모멘텀";
  const scoreNote =
    state.rebalance === "MOM12_1"
      ? "최근 1개월 제외 12개월 수익률"
      : state.rebalance === "XSMOM"
        ? `룩백 ${state.momLookback}개월 수익률 − 유니버스 평균`
        : `전월 말 기준 ${state.momLookback}개월 수익률`;
  return `<div class="card pad" id="momHoldings"><div class="section-title">월간 편입 표 (${title} · 최근 ${slice.length}개월)</div>
    <table><thead><tr><th>월</th><th>코드</th><th>종목 · 비중</th></tr></thead><tbody>${body}</tbody></table>
    <div class="warn">편입은 ${scoreNote} 상위 ${state.momTopN}${dual ? " · 절대모멘텀(안전자산 대비) 필터" : ""} · 교체 회전(TO)에 거래비용 적용 · 당월 성과는 순위 산정에 쓰지 않음</div>
  </div>`;
}


/* ===== Batch 3: 멀티 포트 비교 (UI orchestration of two backtest runs) ===== */

function currentStrategyCfg() {
  return {
    rebalance: state.rebalance,
    momLookback: state.momLookback,
    momTopN: state.momTopN,
    weighting: state.weighting,
    volWindow: state.volWindow,
    maOverlay: state.maOverlay,
    maWindow: state.maWindow,
    maSignalFreq: normMaSignalFreq(state.maSignalFreq),
    cashCode: state.cashCode || "153130",
    maCashPct: state.maCashPct,
    regimeHedge: state.regimeHedge,
    regimeHedgeMode: state.regimeHedgeMode,
    regimeHedgePct: Math.min(0.15, Math.max(0, Number(state.regimeHedgePct) || 0.15)),
    regimeHedgeCode: state.regimeHedgeCode || "114800",
    goldOn: state.goldOn,
    goldSleevePct: clampGoldSleeve(state.goldSleevePct),
    goldLookback: state.goldLookback,
    goldCode: resolveGoldCode(state.goldCode),
    bandOn: !!state.bandOn,
    bandPct: clampBandPct(state.bandPct),
    volTarget: !!state.volTarget,
    volTargetPct: Math.max(0.01, Math.min(0.5, Number(state.volTargetPct) || 0.1)),
    volTargetWindow: Math.max(5, Number(state.volTargetWindow) || 60),
    sleeveTrend: !!state.sleeveTrend,
    sleeveTrendMode: state.sleeveTrendMode === "ma" ? "ma" : "abs",
    sleeveTrendLookback: Number(state.sleeveTrendLookback) >= 3 ? 3 : 1,
    tradeCost: clampTradeCost(state.tradeCost),
    dcaOn: state.dcaOn,
    initialCapital: state.initialCapital,
    monthlyAmount: state.monthlyAmount,
    totalReturn: state.totalReturn,
  };
}

function slotLabelFromPicks(picks, presetKey) {
  if (presetKey && PRESETS[presetKey]) return PRESETS[presetKey].label;
  if (!picks || !picks.length) return "빈 포트";
  const codes = picks.map(([c]) => c);
  if (codes.length <= 3) return `커스텀 (${codes.join("+")})`;
  return `커스텀 (${codes.length}종목)`;
}

function buildSlotFromLastRun() {
  const pack = state.lastRun;
  if (!pack || !pack.result || pack.result.error) return null;
  const picks = pack.picks.map(([c, w]) => [c, w]);
  return {
    label: slotLabelFromPicks(picks, state.activePreset),
    presetKey: state.activePreset,
    picks,
    cfg: currentStrategyCfg(),
    requestedStart: pack.requestedStart || pack.result.start,
    requestedEnd: pack.requestedEnd || pack.result.end,
    result: pack.result,
  };
}

function saveCurrentToSlot(slotId) {
  const slot = buildSlotFromLastRun();
  if (!slot) {
    setCompareStatus("저장할 실행 결과가 없습니다. 먼저 백테스트를 실행하세요.");
    return;
  }
  state.compareSlots[slotId] = slot;
  updateComparePanel();
  setCompareStatus(`슬롯 ${slotId}에 저장: ${slot.label}`);
  if (state.compareSlots.A && state.compareSlots.B) {
    showCompareView().catch((err) => setCompareStatus(String(err.message || err)));
  }
}

function clearCompareSlots() {
  state.compareSlots = { A: null, B: null };
  state.viewMode = "single";
  updateComparePanel();
  setCompareStatus("슬롯 A/B를 비웠습니다.");
  if (state.lastRun && state.lastRun.result && !state.lastRun.result.error) {
    const p = state.lastRun;
    renderResult(p.result, p.bench, p.picks, p.corr, p.tax, p.windowInfo);
  }
}

function holdingsSummary(picks) {
  if (!picks || !picks.length) return "—";
  return picks
    .map(([c, w]) => `${c} ${Number(w).toFixed(w % 1 ? 1 : 0)}%`)
    .join(" · ");
}

function updateComparePanel() {
  const a = state.compareSlots.A;
  const b = state.compareSlots.B;
  const elA = $("#slotAStatus");
  const elB = $("#slotBStatus");
  if (elA) {
    elA.textContent = a
      ? `A · ${a.label} · ${a.result.start}~${a.result.end}`
      : "A · 비어 있음";
    elA.classList.toggle("filled", !!a);
  }
  if (elB) {
    elB.textContent = b
      ? `B · ${b.label} · ${b.result.start}~${b.result.end}`
      : "B · 비어 있음";
    elB.classList.toggle("filled", !!b);
  }
  const btnShow = $("#btnShowCompare");
  if (btnShow) btnShow.disabled = !(a && b);
}

function setCompareStatus(msg) {
  const el = $("#compareStatus");
  if (el) el.textContent = msg || "";
}

/** Ensure prices + run one portfolio with explicit picks/cfg/window. */
async function executePortBacktest(picks, start, end, cfg) {
  const codes = picks.map(([c]) => c);
  const needCash =
    cfg.rebalance === "DMOM" ||
    cfg.maOverlay ||
    (cfg.regimeHedge && cfg.regimeHedgeMode === "cash") ||
    !!cfg.volTarget ||
    !!cfg.sleeveTrend;
  const needHedge = !!cfg.regimeHedge;
  const needGold = !!cfg.goldOn;
  const extra = [BENCH];
  if (needCash) extra.push(cfg.cashCode || "153130");
  if (needHedge) {
    extra.push(REGIME_HEDGE_B);
    if (cfg.regimeHedgeMode === "inverse") extra.push(cfg.regimeHedgeCode || "114800");
    else extra.push(cfg.cashCode || "153130");
  }
  if (needGold) extra.push(resolveGoldCode(cfg.goldCode), GOLD_CASH);
  await ensurePrices([...codes, ...extra]);
  for (const c of codes) {
    if (!state.prices[c]) return { error: `${c} 시세가 없습니다.` };
  }
  const hedgeLoad = needHedge
    ? [
        REGIME_HEDGE_B,
        cfg.regimeHedgeMode === "cash"
          ? cfg.cashCode || "153130"
          : cfg.regimeHedgeCode || "114800",
      ]
    : [];
  const loadCodes = [
    ...new Set([
      ...codes,
      BENCH,
      ...(needCash ? [cfg.cashCode || "153130"] : []),
      ...hedgeLoad,
      ...(needGold ? [resolveGoldCode(cfg.goldCode), GOLD_CASH] : []),
    ]),
  ];
  const useTr = cfg.totalReturn && hasRealTrData();
  const priceMap = useTr
    ? buildTotalReturnPrices(state.prices, loadCodes)
    : state.prices;
  const initial = cfg.dcaOn ? cfg.initialCapital : 1;
  const monthly = cfg.dcaOn ? cfg.monthlyAmount : 0;
  return backtest(Object.fromEntries(picks), priceMap, start, end, cfg.rebalance, initial, monthly, {
    lookback: cfg.momLookback,
    topN: cfg.momTopN,
    cost: clampTradeCost(cfg.tradeCost != null ? cfg.tradeCost : state.tradeCost),
    weighting: cfg.weighting,
    volWindow: cfg.volWindow,
    maOverlay: cfg.maOverlay,
    maWindow: cfg.maWindow,
    maSignalFreq: normMaSignalFreq(cfg.maSignalFreq),
    cashCode: cfg.cashCode || "153130",
    maCashPct: cfg.maCashPct,
    regimeHedge: cfg.regimeHedge,
    regimeHedgeMode: cfg.regimeHedgeMode,
    regimeHedgePct: Math.min(0.15, Math.max(0, Number(cfg.regimeHedgePct) || 0.15)),
    regimeHedgeCode: cfg.regimeHedgeCode || "114800",
    goldOn: cfg.goldOn,
    goldSleevePct: clampGoldSleeve(cfg.goldSleevePct),
    goldLookback: cfg.goldLookback,
    goldCode: resolveGoldCode(cfg.goldCode),
    bandOn: !!cfg.bandOn,
    bandPct: clampBandPct(cfg.bandPct),
    volTarget: !!cfg.volTarget,
    volTargetPct: Math.max(0.01, Math.min(0.5, Number(cfg.volTargetPct) || 0.1)),
    volTargetWindow: Math.max(5, Number(cfg.volTargetWindow) || 60),
    sleeveTrend: !!cfg.sleeveTrend,
    sleeveTrendMode: cfg.sleeveTrendMode === "ma" ? "ma" : "abs",
    sleeveTrendLookback: Number(cfg.sleeveTrendLookback) >= 3 ? 3 : 1,
    etfFlags: etfFlagsMap(),
  });
}

/** Re-run both slots on intersection of their result windows. */
async function alignCompareSlots() {
  const a = state.compareSlots.A;
  const b = state.compareSlots.B;
  if (!a || !b) throw new Error("슬롯 A와 B를 모두 채워 주세요.");
  const commonStart =
    a.result.start > b.result.start ? a.result.start : b.result.start;
  const commonEnd = a.result.end < b.result.end ? a.result.end : b.result.end;
  if (commonStart >= commonEnd) {
    throw new Error(
      `공통 기간이 없습니다. A ${a.result.start}~${a.result.end} / B ${b.result.start}~${b.result.end}`
    );
  }
  const ra = await executePortBacktest(a.picks, commonStart, commonEnd, a.cfg);
  if (ra.error) throw new Error(`포트 A: ${ra.error}`);
  const rb = await executePortBacktest(b.picks, commonStart, commonEnd, b.cfg);
  if (rb.error) throw new Error(`포트 B: ${rb.error}`);
  const start = ra.start > rb.start ? ra.start : rb.start;
  const end = ra.end < rb.end ? ra.end : rb.end;
  return {
    A: { ...a, result: ra },
    B: { ...b, result: rb },
    commonStart: start,
    commonEnd: end,
    truncated:
      commonStart > (a.requestedStart || a.result.start) ||
      commonStart > (b.requestedStart || b.result.start) ||
      a.result.start !== ra.start ||
      b.result.start !== rb.start,
  };
}

async function showCompareView() {
  setCompareStatus("비교 계산 중…");
  const aligned = await alignCompareSlots();
  state.viewMode = "compare";
  renderCompareView(aligned);
  setCompareStatus(`비교 기간 ${aligned.commonStart} ~ ${aligned.commonEnd} (교집합)`);
}

async function runDualPresetCompare() {
  const keyA = $("#comparePresetA") && $("#comparePresetA").value;
  const keyB = $("#comparePresetB") && $("#comparePresetB").value;
  if (!keyA || !keyB) {
    setCompareStatus("프리셋 A·B를 선택하세요.");
    return;
  }
  if (keyA === keyB) {
    setCompareStatus("서로 다른 프리셋을 고르세요.");
    return;
  }
  if (!PRESETS[keyA] || !PRESETS[keyB]) {
    setCompareStatus("알 수 없는 프리셋입니다.");
    return;
  }
  setCompareStatus("프리셋 비교 실행 중…");
  const [reqStart, reqEnd] = periodBounds();
  const cfg = currentStrategyCfg();
  const picksA = Object.entries(PRESETS[keyA].w).filter(([, w]) => w > 0);
  const picksB = Object.entries(PRESETS[keyB].w).filter(([, w]) => w > 0);
  await ensurePrices([
    ...picksA.map(([c]) => c),
    ...picksB.map(([c]) => c),
    BENCH,
  ]);
  const ra0 = await executePortBacktest(picksA, reqStart, reqEnd, cfg);
  if (ra0.error) {
    setCompareStatus(`포트 A: ${ra0.error}`);
    return;
  }
  const rb0 = await executePortBacktest(picksB, reqStart, reqEnd, cfg);
  if (rb0.error) {
    setCompareStatus(`포트 B: ${rb0.error}`);
    return;
  }
  state.compareSlots.A = {
    label: PRESETS[keyA].label,
    presetKey: keyA,
    picks: picksA,
    cfg,
    requestedStart: reqStart,
    requestedEnd: reqEnd,
    result: ra0,
  };
  state.compareSlots.B = {
    label: PRESETS[keyB].label,
    presetKey: keyB,
    picks: picksB,
    cfg,
    requestedStart: reqStart,
    requestedEnd: reqEnd,
    result: rb0,
  };
  updateComparePanel();
  await showCompareView();
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCompareView(aligned) {
  const host = $("#result");
  const a = aligned.A;
  const b = aligned.B;
  const ra = a.result;
  const rb = b.result;
  destroyExtraCharts();
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const fmtDiff = (na, nb, kind) => {
    if (na == null || nb == null || !Number.isFinite(na) || !Number.isFinite(nb)) {
      return { text: "—", klass: "" };
    }
    const d = na - nb;
    if (kind === "pct") return { text: pct(d, 2), klass: cls(d) };
    if (kind === "num") return { text: d.toFixed(2), klass: cls(d) };
    return { text: String(d), klass: cls(d) };
  };
  const row = (label, textA, textB, na, nb, kind, klassA, klassB) => {
    const d = fmtDiff(na, nb, kind);
    return `<tr>
      <th scope="row">${label}</th>
      <td class="${klassA || ""}">${textA}</td>
      <td class="${klassB || ""}">${textB}</td>
      <td class="${d.klass}">${d.text}</td>
    </tr>`;
  };

  const periodA = `${ra.start} ~ ${ra.end}`;
  const periodB = `${rb.start} ~ ${rb.end}`;
  const yearsStr = (r) => `${Number(r.years).toFixed(1)}년 · ${r.days}일`;

  const kpiTable = `<div class="card pad compare-kpi-card">
    <div class="section-title">멀티 포트 비교 · KPI</div>
    <div class="compare-labels">
      <span class="slot-pill slot-a">A · ${escapeHtml(a.label)}</span>
      <span class="slot-pill slot-b">B · ${escapeHtml(b.label)}</span>
    </div>
    <div class="compare-table-wrap">
      <table class="compare-table">
        <thead><tr><th>지표</th><th>A</th><th>B</th><th>차이(A−B)</th></tr></thead>
        <tbody>
          ${row("연환산 수익률", pct(ra.cagr), pct(rb.cagr), ra.cagr, rb.cagr, "pct", cls(ra.cagr), cls(rb.cagr))}
          ${row("누적 수익률", pct(ra.totalRet, 2), pct(rb.totalRet, 2), ra.totalRet, rb.totalRet, "pct", cls(ra.totalRet), cls(rb.totalRet))}
          ${row("최대낙폭", pct(ra.mdd), pct(rb.mdd), ra.mdd, rb.mdd, "pct", "neg", "neg")}
          ${row("변동성", pct(ra.vol, 1), pct(rb.vol, 1), ra.vol, rb.vol, "pct", "", "")}
          ${row("샤프", ra.sharpe.toFixed(2), rb.sharpe.toFixed(2), ra.sharpe, rb.sharpe, "num", cls(ra.sharpe), cls(rb.sharpe))}
          <tr><th scope="row">기간</th><td>${periodA}</td><td>${periodB}</td><td>—</td></tr>
          <tr><th scope="row">길이</th><td>${yearsStr(ra)}</td><td>${yearsStr(rb)}</td><td>—</td></tr>
        </tbody>
      </table>
    </div>
    <div class="warn">비교 창 ${aligned.commonStart} ~ ${aligned.commonEnd} (두 포트 결과의 교집합으로 재실행) · 과거 시뮬 · 투자 자문 아님</div>
  </div>`;

  const holdCard = `<div class="card pad compare-hold-card">
    <div class="section-title">보유 비중</div>
    <div class="compare-hold-grid">
      <div><div class="slot-pill slot-a">A</div><p class="muted-note">${escapeHtml(holdingsSummary(a.picks))}</p></div>
      <div><div class="slot-pill slot-b">B</div><p class="muted-note">${escapeHtml(holdingsSummary(b.picks))}</p></div>
    </div>
  </div>`;

  const chartCard = `<div class="card chart-wrap compare-chart-wrap"><canvas id="compareCurve" height="320"></canvas></div>`;
  const actions = `<div class="export-bar btn-row compare-actions">
    <button type="button" class="secondary" id="btnBackSingle">단일 결과로</button>
    <button type="button" class="secondary" id="btnClearSlotsFromCompare">슬롯 비우기</button>
  </div>`;

  host.innerHTML = `${actions}${kpiTable}${chartCard}${holdCard}
    <div class="card pad"><div class="section-title">리뷰 에이전트</div>
    <div class="agent" id="agentText"></div></div>`;

  drawCompareChart(ra, rb, a.label, b.label);
  const agent = $("#agentText");
  if (agent) {
    agent.textContent = [
      `비교 메모 · 공통 기간 ${aligned.commonStart} ~ ${aligned.commonEnd}`,
      "",
      `· A ${a.label}: 연환산 ${pct(ra.cagr)} · 누적 ${pct(ra.totalRet, 2)} · MDD ${pct(ra.mdd)} · 샤프 ${ra.sharpe.toFixed(2)}`,
      `· B ${b.label}: 연환산 ${pct(rb.cagr)} · 누적 ${pct(rb.totalRet, 2)} · MDD ${pct(rb.mdd)} · 샤프 ${rb.sharpe.toFixed(2)}`,
      `· 연환산 차이(A−B) ${pct(ra.cagr - rb.cagr, 2)} · MDD 차이(A−B) ${pct(ra.mdd - rb.mdd, 2)}`,
      "",
      "한계",
      "· 두 포트 각각 동일 엔진으로 재실행한 교집합 기간입니다.",
      "· 설정(리밸런싱·DCA·오버레이)이 슬롯마다 다를 수 있습니다.",
      "· 과거 숫자로 미래 비중을 정하면 안 됩니다.",
    ].join("\n");
  }

  const backBtn = $("#btnBackSingle");
  if (backBtn)
    backBtn.onclick = () => {
      state.viewMode = "single";
      if (state.lastRun && state.lastRun.result && !state.lastRun.result.error) {
        const p = state.lastRun;
        renderResult(p.result, p.bench, p.picks, p.corr, p.tax, p.windowInfo);
      } else {
        host.innerHTML = `<div class="card pad empty">단일 결과가 없습니다. 백테스트를 실행하세요.</div>`;
      }
    };
  const clearBtn = $("#btnClearSlotsFromCompare");
  if (clearBtn) clearBtn.onclick = () => clearCompareSlots();
}

function drawCompareChart(ra, rb, labelA, labelB) {
  const setB = new Set(rb.curve.map((p) => p.d));
  const labels = ra.curve.map((p) => p.d).filter((d) => setB.has(d));
  const mapA = Object.fromEntries(ra.curve.map((p) => [p.d, p.ret]));
  const mapB = Object.fromEntries(rb.curve.map((p) => [p.d, p.ret]));
  const baseA = labels.length ? mapA[labels[0]] || 0 : 0;
  const baseB = labels.length ? mapB[labels[0]] || 0 : 0;
  const seriesA = labels.map((d) => ((1 + mapA[d]) / (1 + baseA) - 1) * 100);
  const seriesB = labels.map((d) => ((1 + mapB[d]) / (1 + baseB) - 1) * 100);
  const ctx = document.getElementById("compareCurve");
  if (!ctx) return;
  if (state.compareChart) {
    state.compareChart.destroy();
    state.compareChart = null;
  }
  state.compareChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `A · ${labelA}`,
          data: seriesA,
          borderColor: "#7dd3c0",
          backgroundColor: "rgba(125,211,192,.10)",
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: `B · ${labelB}`,
          data: seriesB,
          borderColor: "#f0c27a",
          backgroundColor: "rgba(240,194,122,.08)",
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#8b9aab" } },
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${fmtPctTooltip(c.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#667687", maxTicksLimit: 8 },
          grid: { color: "rgba(39,49,64,.45)" },
        },
        y: {
          ticks: {
            color: "#667687",
            callback: (v) => v + "%",
          },
          grid: { color: "rgba(39,49,64,.45)" },
        },
      },
    },
  });
}

function fillComparePresetSelects() {
  ["comparePresetA", "comparePresetB"].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = idx === 0 ? "프리셋 A" : "프리셋 B";
    sel.appendChild(ph);
    Object.entries(PRESETS).forEach(([k, p]) => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    if (cur && PRESETS[cur]) sel.value = cur;
  });
}

function wireComparePanel() {
  fillComparePresetSelects();
  updateComparePanel();
  const saveA = $("#btnSlotSaveA");
  if (saveA) saveA.onclick = () => saveCurrentToSlot("A");
  const saveB = $("#btnSlotSaveB");
  if (saveB) saveB.onclick = () => saveCurrentToSlot("B");
  const show = $("#btnShowCompare");
  if (show)
    show.onclick = () => {
      showCompareView().catch((err) => setCompareStatus(String(err.message || err)));
    };
  const clear = $("#btnClearSlots");
  if (clear) clear.onclick = () => clearCompareSlots();
  const dual = $("#btnDualPresetCompare");
  if (dual)
    dual.onclick = () => {
      runDualPresetCompare().catch((err) => setCompareStatus(String(err.message || err)));
    };
}


function renderResult(r, bench, picks, corr, tax, windowInfo) {
  const host = $("#result");
  if (r.error) {
    destroyExtraCharts();
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    host.innerHTML = `<div class="card pad empty">${r.error}</div>`;
    return;
  }
  state.viewMode = "single";
  const dcaNote =
    r.monthlyContribution > 0
      ? `<div class="warn">월 적립 · 납입 합 ${won(r.totalInvested)} → 기말 ${won(r.finalValue)} · ${r.contributions}회 납입 · 수익률은 납입 원금 합 대비</div>`
      : "";
  const usingTr = state.totalReturn && hasRealTrData();
  const trNote = usingTr
    ? `<div class="warn">Total Return · 실제 TR/분배 시계열 적용 · 세금 미반영</div>`
    : `<div class="warn price-return-banner">이 시뮬은 수정주가 기준입니다(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬. 분배금 현금흐름은 「배당 현금흐름」 모드에서 원가격+실제 분배금으로 따로 봅니다.</div>`;
  const retLabel = usingTr ? "총수익(TR·분배 포함)" : "수정주가 기준(분배금 세전 재투자 포함·세금 미반영)";
  const costRate = r.tradeCost != null ? Number(r.tradeCost) : clampTradeCost(state.tradeCost);
  const costDrag = r.totalCostDrag != null ? Number(r.totalCostDrag) : 0;
  const costNote = `<div class="warn">거래비용 · 가정 ${ (costRate * 100).toFixed(2) }% (${ Math.round(costRate * 10000) }bps) · 누적 비용드래그 ${
    r.initialCapital > 1 ? won(costDrag) : costDrag.toFixed(6) + " (상대원금=1)"
  } · 공식: 리밸 시 value −= value×TO×rate, TO=0.5×Σ|Δw| (편도 회전율)</div>`;
  destroyExtraCharts();
  const dd = computeDrawdown(r.curve);
  const benchDd = bench && bench.curve ? computeDrawdown(bench.curve) : null;
  state.lastPortCurve = r.curve;
  state.lastBenchCurve = bench?.curve || null;
  const partialYears = partialYearSet(r.curve);
  const yearlyRows = Object.keys(r.yearly || {})
    .sort()
    .map((y) => {
      const a = r.yearly[y];
      const b = bench.yearly ? bench.yearly[y] : undefined;
      const yLabel = partialYears.has(y) ? `${y}*` : y;
      return `<tr><td>${yLabel}</td><td class="${cls(a)}">${pct(a, 2)}</td><td class="${cls(b)}">${pct(b, 2)}</td></tr>`;
    })
    .join("");
  const partialNote = partialYears.size
    ? `<div class="warn">* 부분 연도: 해당 연도에 1월 또는 12월 거래일이 없어 공개 연간 수익률과 직접 비교하면 안 됩니다.</div>`
    : "";
  const momTable = renderMomHoldings(r.momHoldings);
  const regimeNote = r.lastRegime
    ? `<div class="warn">이동평균 트렌드 오버레이 · 최근 국면: <strong>${r.lastRegime === "on" ? "위험온" : "위험오프"}</strong> · MA${state.maWindow} · 안전자산 ${state.cashCode}${r.maSignalFreq === "rebal" ? " · 신호: 리밸 주기에 맞춤" : " · 신호: 매월(월초·전월 말 종가)"} · 국면 전환 ${r.maSwitchCount || 0}회 · 파라미터 민감 · 투자 자문 아님</div>`
    : "";
  const hedgeNote =
    r.hedgeLog
      ? `<div class="warn">국면 헤지(실험) · 최근: <strong>${r.hedgeActive ? "헤지 소비중" : "헤지 없음"}</strong> · 신호 069500∧133690 MA↓ · 모드 ${state.regimeHedgeMode === "cash" ? "현금/단기채" : "−1x 114800"} · 상한 ${(Math.min(0.15, state.regimeHedgePct) * 100).toFixed(0)}% · 월1회 · 2X 금지 · 실험·자문 아님</div>`
      : "";
  const goldNote =
    r.goldLog
      ? `<div class="warn">금 온/오프 슬리브 · 최근: <strong>${r.goldActive ? "ON" : "OFF"}</strong> · 보유 ${r.goldHolding || "—"} · 슬리브 ${(clampGoldSleeve(state.goldSleevePct) * 100).toFixed(0)}% · 룩백 ${state.goldLookback}개월 · 신호 ${resolveGoldCode(state.goldCode)} vs 153130 · 과거 시뮬 · 투자 권유 아님</div>`
      : "";
  const weightNote =
    state.weighting === "invVol"
      ? `<div class="warn">비중 방식: 역변동성(최근 ${state.volWindow}거래일, 리밸런싱 전일까지) · 모멘텀/듀얼도 편입 집합에 동일 적용</div>`
      : "";
  const volTargetNote = state.volTarget
    ? `<div class="warn">변동성 타깃 · 목표 ${(Math.max(0.01, Math.min(0.5, Number(state.volTargetPct) || 0.1)) * 100).toFixed(0)}% · 룩백 ${state.volTargetWindow || 60}거래일 · 스케일≤100% · 레버리지/인버스 제외 · 잔여 ${state.cashCode || "153130"} · 과거 시뮬</div>`
    : "";
  const sleeveTrendNote = state.sleeveTrend
    ? `<div class="warn">슬리브 추세 · 신호 ${state.sleeveTrendMode === "ma" ? "이동평균" : "절대모멘텀"} · 룩백 ${state.sleeveTrendLookback}개월 · OFF→안전자산 · 결측=OFF · 과거 시뮬</div>`
    : "";
  const bandNote = r.bandApplied

    ? `<div class="warn">리밸런싱 밴드 · ±${(Number(r.bandPct) * 100).toFixed(0)}% · 리밸런싱 ${r.rebalCount != null ? r.rebalCount : "—"}회 · Q/Y/M 캘린더 무시·매일 드리프트 검사 · MOM/DMOM에는 미적용 · 과거 시뮬</div>`
    : r.rebalCount != null && (state.rebalance !== "N" || r.sleeveUpdateCount || r.dcaBuyCount)
      ? `<div class="warn">리밸런싱 ${r.rebalCount}회 (캘린더 ${state.rebalance})${r.sleeveUpdateCount ? ` · 오버레이 슬리브 갱신 ${r.sleeveUpdateCount}회` : ""}${r.dcaBuyCount ? ` · 적립 추가매수 ${r.dcaBuyCount}회` : ""}</div>`
      : "";
  const winCard = renderWindowCard(windowInfo || (state.lastRun && state.lastRun.windowInfo));
  const exportBar = renderExportBar();
  host.innerHTML = `${exportBar}${portLineHtml(picks)}<div class="kpis">${kpi("연환산 수익률", pct(r.cagr), cls(r.cagr))}${kpi("누적 수익률", pct(r.totalRet, 2), cls(r.totalRet))}${kpi("최대낙폭", pct(r.mdd), "neg")}${kpi("변동성", pct(r.vol, 1), "")}${kpi("샤프", r.sharpe.toFixed(2), cls(r.sharpe))}</div>${winCard}<div class="card chart-wrap"><canvas id="curve"></canvas></div>${dcaNote}${trNote}${costNote}${regimeNote}${hedgeNote}${goldNote}${volTargetNote}${sleeveTrendNote}${weightNote}${bandNote}${momTable}${renderDrawdownCard(dd, benchDd)}${renderRollingCard()}${renderSensitivityCard()}${renderCorrCard(corr)}${renderTaxCard(tax)}<div class="bottom"><div class="card pad"><div class="section-title">연도별 수익률 · 벤치마크 KODEX 200</div><table><thead><tr><th>연도</th><th>포트폴리오</th><th>KODEX 200</th></tr></thead><tbody>${yearlyRows}</tbody></table><div class="warn">연도별은 전년 말(또는 백테스트 시작) 대비 해당 연 말. 일괄매수(lump)는 연도 복리 합 = 누적 수익률.</div>${partialNote}<div class="warn">공통 기간 ${r.start} ~ ${r.end} · ${r.days}거래일 · ${retLabel}</div></div><div class="card pad"><div class="section-title">리뷰 에이전트</div><div class="agent" id="agentText"></div></div></div>`;
  drawChart(r, bench);
  drawDrawdownChart(dd, benchDd);
  drawRollingChart(r.curve, state.rollingWindow);
  wireRollingChips();
  wireSensitivityCard();
  wireExportBar();
  $("#agentText").textContent = reviewAgent(r, bench, picks);
}

function kpi(label, val, klass) {
  return `<div class="card kpi"><div class="label">${label}</div><div class="val ${klass}">${val}</div></div>`;
}

function drawChart(r, bench) {
  // Plot cumulative return % matching KPI 누적 수익률 (ret vs invested-to-date).
  const bmap = Object.fromEntries((bench.curve || []).map((p) => [p.d, p.ret]));
  const labels = r.curve.map((p) => p.d);
  const port = r.curve.map((p) => p.ret * 100);
  const ben = r.curve.map((p) => (bmap[p.d] ?? 0) * 100);
  const ctx = document.getElementById("curve");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "누적 수익률",
          data: port,
          borderColor: "#7dd3c0",
          backgroundColor: "rgba(125,211,192,.12)",
          fill: true,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "KODEX 200",
          data: ben,
          borderColor: "#8b9aab",
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.4,
          borderDash: [4, 4],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#8b9aab" } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmtPctTooltip(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#667687", maxTicksLimit: 8 }, grid: { color: "rgba(39,49,64,.45)" } },
        y: {
          ticks: {
            color: "#667687",
            callback: (v) => v + "%",
          },
          grid: { color: "rgba(39,49,64,.45)" },
        },
      },
    },
  });
}

function reviewAgent(r, bench, picks) {
  const lines = [];
  lines.push(`검수 메모 · 공통 기간 ${r.start} ~ ${r.end} (${r.years.toFixed(1)}년)`, "");
  if (r.monthlyContribution > 0) {
    lines.push(
      `· 월 적립 모드: 시작 ${won(r.initialCapital)} + 매월 ${won(r.monthlyAmount || r.monthlyContribution)}.`
    );
    lines.push(`· 납입 합 ${won(r.totalInvested)}, 기말 평가 ${won(r.finalValue)}.`);
  }
  if (state.totalReturn && hasRealTrData()) lines.push("· Total Return(실제 TR 시계열) 적용 중입니다.");
  else lines.push("· 수정주가 기준입니다(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬.");
  lines.push(`· 거래비용 ${ (clampTradeCost(state.tradeCost) * 100).toFixed(2) }% · 누적 드래그 ${ r.totalCostDrag != null ? Number(r.totalCostDrag).toFixed(6) : "—" }.`);
  const vs = r.cagr - (bench.cagr || 0);
  if (vs > 0.01) lines.push(`· 같은 기간 KODEX 200보다 연환산 ${pct(vs)} 앞섭니다.`);
  else if (vs < -0.01) lines.push(`· KODEX 200보다 연환산 ${pct(vs)} 뒤처졌습니다.`);
  else lines.push("· 벤치마크와 거의 비슷한 속도입니다.");
  if (r.mdd < -0.35) lines.push("· 최대낙폭이 35%를 넘습니다.");
  else if (r.mdd < -0.2) lines.push("· 낙폭 20%대. 주식형 비중이 느껴지는 수준입니다.");
  else lines.push("· 낙폭은 비교적 관리된 편입니다.");
  if (picks.length < 3) lines.push("· 종목이 적습니다.");
  const risky = riskyWeightSum(Object.fromEntries(picks));
  if (risky > 70) lines.push("· IRP 안전자산 30% 참고 기준을 넘는 위험자산 비중입니다.");
  lines.push(
    "",
    "한계",
    "· 시세는 수정주가라 분배금(세전) 재투자 효과가 이미 들어 있습니다. 별도 TR 가산은 이중 계산이라 쓰지 않습니다.",
    "· 리밸런싱 거래비용은 편도 회전율(TO)×비용률로 차감합니다.",
    "· 세금 모형은 단순화되어 있습니다.",
    "· 과거 숫자로 미래 비중을 정하면 안 됩니다.",
    "· 월 적립 연환산은 납입 원금 합 대비 단순 계산입니다.",
    "· 모멘텀·역변동성·이동평균·금 슬리브 파라미터는 민감하며 과거≠미래입니다.",
    "· 시작일 민감도 히트맵은 같은 설정·고정 종료일에서 시작월만 바꾼 과거 관측값입니다."
  );
  return lines.join("\n");
}

document.addEventListener("DOMContentLoaded", () => {
  const periodEl = $("#period");
  if (periodEl && periodEl.value) state.period = periodEl.value;
  $("#period").onchange = (e) => {
    state.period = e.target.value;
    $("#customDates").style.display = e.target.value === "custom" ? "flex" : "none";
  };
  const syncMomControls = () => {
    const on =
      state.rebalance === "MOM" ||
      state.rebalance === "DMOM" ||
      state.rebalance === "MOM12_1" ||
      state.rebalance === "XSMOM";
    const row = $("#momControls");
    if (row) row.style.display = on ? "flex" : "none";
    const hint = $("#momHint");
    if (hint) {
      hint.style.display = on ? "block" : "none";
      if (state.rebalance === "DMOM") {
        hint.textContent =
          "선택한 ETF가 듀얼 모멘텀 유니버스입니다. 상대 모멘텀 상위 N 후 안전자산 대비 절대 필터 · 교체 회전(TO)에 거래비용 슬라이더 적용.";
      } else if (state.rebalance === "MOM12_1") {
        hint.textContent =
          "12-1 스킵 모멘텀: 전월 말 신호 · 최근 1개월을 뺀 12개월 수익률 상위 N 동일비중 · 룩어헤드 없음 · 거래비용 슬라이더 적용.";
      } else if (state.rebalance === "XSMOM") {
        hint.textContent =
          "XS 잔차 모멘텀: 전월 말 룩백 수익률 − 유니버스 평균 · 상위 N · 유니버스 5종 미만이면 실행하지 않음 · 거래비용 슬라이더 적용.";
      } else {
        hint.textContent =
          "선택한 ETF가 모멘텀 유니버스입니다. 전월 말 기준 수익률 상위 N을 동일비중 · 교체 회전(TO)에 거래비용 슬라이더 적용.";
      }
    }
    const cashRow = $("#dmomCashRow");
    if (cashRow)
      cashRow.style.display =
        state.rebalance === "DMOM" ||
        state.maOverlay ||
        (state.regimeHedge && state.regimeHedgeMode === "cash") ||
        state.volTarget ||
        state.sleeveTrend
          ? "flex"
          : "none";
  };
  const syncStratControls = () => {
    const maRow = $("#maOverlayRow");
    if (maRow) maRow.style.display = state.maOverlay ? "flex" : "none";
    const rhRow = $("#regimeHedgeRow");
    if (rhRow) rhRow.style.display = state.regimeHedge ? "flex" : "none";
    const gRow = $("#goldOnRow");
    if (gRow) gRow.style.display = state.goldOn ? "flex" : "none";
    const bandRow = $("#bandRow");
    if (bandRow) bandRow.style.display = state.bandOn ? "flex" : "none";
    const vtRow = $("#volTargetRow");
    if (vtRow) vtRow.style.display = state.volTarget ? "flex" : "none";
    const vtHint = $("#volTargetHint");
    if (vtHint) vtHint.style.display = state.volTarget ? "block" : "none";
    const stRow = $("#sleeveTrendRow");
    if (stRow) stRow.style.display = state.sleeveTrend ? "flex" : "none";
    const stHint = $("#sleeveTrendHint");
    if (stHint) stHint.style.display = state.sleeveTrend ? "block" : "none";
    syncMaFreqHint();
    const bandHint = $("#bandHint");
    if (bandHint) {
      const mom =
        state.rebalance === "MOM" ||
        state.rebalance === "DMOM" ||
        state.rebalance === "MOM12_1" ||
        state.rebalance === "XSMOM";
      bandHint.style.display = state.bandOn ? "block" : "none";
      if (state.bandOn) {
        bandHint.textContent = mom
          ? "밴드 ON이어도 모멘텀류(MOM/MOM12_1/XSMOM/DMOM)는 월간 교체 로직을 유지합니다(밴드 미적용)."
          : "밴드 ON이면 Q/Y/M 캘린더를 쓰지 않고 매일 목표 대비 드리프트를 봅니다. |현재−목표| > 밴드(%)인 종목이 있으면 목표 비중으로 맞춥니다. 월 적립은 목표 비중 추가 매수만, 국면헤지·금 슬리브·변동성 타깃·슬리브 추세는 월초 슬리브만 갱신합니다(전체 재조정 아님).";
      }
    }
    syncMomControls();
  };
  $("#rebalance").onchange = (e) => {
    state.rebalance = e.target.value;
    syncStratControls();
  };
  const lb = $("#momLookback");
  if (lb)
    lb.onchange = (e) => {
      state.momLookback = Number(e.target.value) >= 3 ? 3 : 1;
    };
  const tn = $("#momTopN");
  if (tn)
    tn.onchange = (e) => {
      state.momTopN = Math.max(1, Math.min(20, Number(e.target.value) || 3));
    };
  const weightingEl = $("#weighting");
  if (weightingEl)
    weightingEl.onchange = (e) => {
      state.weighting = e.target.value === "invVol" ? "invVol" : "fixed";
    };
  const maChk = $("#maOverlay");
  if (maChk)
    maChk.onchange = (e) => {
      state.maOverlay = !!e.target.checked;
      syncStratControls();
    };
  const rhChk = $("#regimeHedge");
  if (rhChk)
    rhChk.onchange = (e) => {
      state.regimeHedge = !!e.target.checked;
      syncStratControls();
    };
  const rhMode = $("#regimeHedgeMode");
  if (rhMode)
    rhMode.onchange = (e) => {
      state.regimeHedgeMode = e.target.value === "cash" ? "cash" : "inverse";
      syncStratControls();
    };
  const rhPct = $("#regimeHedgePct");
  if (rhPct)
    rhPct.onchange = (e) => {
      const v = Number(e.target.value);
      state.regimeHedgePct = Math.min(0.15, Math.max(0, Number.isFinite(v) ? v / 100 : 0.15));
    };
  const goldChk = $("#goldOn");
  if (goldChk)
    goldChk.onchange = (e) => {
      state.goldOn = !!e.target.checked;
      syncStratControls();
    };
  const goldPct = $("#goldSleevePct");
  if (goldPct)
    goldPct.onchange = (e) => {
      const v = Number(e.target.value);
      state.goldSleevePct = clampGoldSleeve(Number.isFinite(v) ? v / 100 : GOLD_SLEEVE_DEFAULT);
    };
  const goldLb = $("#goldLookback");
  if (goldLb)
    goldLb.onchange = (e) => {
      state.goldLookback = Number(e.target.value) >= 3 ? 3 : 1;
    };
  const goldCodeEl = $("#goldCode");
  if (goldCodeEl) {
    goldCodeEl.value = resolveGoldCode(state.goldCode);
    goldCodeEl.onchange = (e) => {
      state.goldCode = resolveGoldCode(e.target.value);
    };
  }
  const vtChk = $("#volTarget");
  if (vtChk)
    vtChk.onchange = (e) => {
      state.volTarget = !!e.target.checked;
      syncStratControls();
    };
  const vtPct = $("#volTargetPct");
  if (vtPct)
    vtPct.onchange = (e) => {
      const v = Number(e.target.value);
      state.volTargetPct = Math.max(0.05, Math.min(0.2, Number.isFinite(v) ? v / 100 : 0.1));
    };
  const vtWin = $("#volTargetWindow");
  if (vtWin)
    vtWin.onchange = (e) => {
      const v = Number(e.target.value);
      state.volTargetWindow = Math.max(20, Math.min(120, Number.isFinite(v) ? v : 60));
    };
  const stChk = $("#sleeveTrend");
  if (stChk)
    stChk.onchange = (e) => {
      state.sleeveTrend = !!e.target.checked;
      syncStratControls();
    };
  const stMode = $("#sleeveTrendMode");
  if (stMode)
    stMode.onchange = (e) => {
      state.sleeveTrendMode = e.target.value === "ma" ? "ma" : "abs";
    };
  const stLb = $("#sleeveTrendLookback");
  if (stLb)
    stLb.onchange = (e) => {
      state.sleeveTrendLookback = Number(e.target.value) >= 3 ? 3 : 1;
    };
  const bandChk = $("#bandOn");
  if (bandChk)
    bandChk.onchange = (e) => {
      state.bandOn = !!e.target.checked;
      syncStratControls();
    };
  const bandPctEl = $("#bandPct");
  if (bandPctEl)
    bandPctEl.onchange = (e) => {
      const v = Number(e.target.value);
      state.bandPct = clampBandPct(Number.isFinite(v) ? v / 100 : BAND_PCT_DEFAULT);
    };
  const maWin = $("#maWindow");
  if (maWin)
    maWin.onchange = (e) => {
      const v = Number(e.target.value);
      state.maWindow = v === 100 ? 100 : 200;
    };
  const maFreqEl = $("#maSignalFreq");
  if (maFreqEl)
    maFreqEl.onchange = (e) => {
      state.maSignalFreq = normMaSignalFreq(e.target.value);
      syncMaFreqHint();
    };
  const cashEl = $("#cashCode");
  if (cashEl)
    cashEl.onchange = (e) => {
      state.cashCode = e.target.value || "153130";
    };
  syncStratControls();
  $("#etfSearch").oninput = (e) => {
    state.search = e.target.value;
    renderList();
  };
  $("#dcaOn").onchange = (e) => {
    state.dcaOn = e.target.checked;
    $("#dcaInputs").style.display = state.dcaOn ? "flex" : "none";
  };
  $("#initialCapital").onchange = (e) => {
    state.initialCapital = Math.max(1, Number(e.target.value) || 1);
  };
  $("#monthlyAmount").onchange = (e) => {
    state.monthlyAmount = Math.max(0, Number(e.target.value) || 0);
  };
  const tcSlider = $("#tradeCost");
  if (tcSlider) {
    const syncTc = (e) => {
      const bps = Number(e.target.value);
      state.tradeCost = clampTradeCost(Number.isFinite(bps) ? bps / 10000 : TRADE_COST_DEFAULT);
      updateTradeCostLabel();
    };
    tcSlider.oninput = syncTc;
    tcSlider.onchange = syncTc;
    updateTradeCostLabel();
  }
  const trOn = $("#trOn");
  if (trOn) {
    trOn.onchange = (e) => {
      state.totalReturn = !!e.target.checked && hasRealTrData();
      if (e.target.checked && !hasRealTrData()) e.target.checked = false;
    };
  }
  const syncAcct = () => {
    state.accountType = $("#acctPension").checked ? "pension" : "taxable";
    $("#pensionTaxRow").style.display = state.accountType === "pension" ? "flex" : "none";
  };
  $("#acctTaxable").onchange = syncAcct;
  $("#acctPension").onchange = syncAcct;
  $("#pensionTaxRate").onchange = (e) => {
    state.pensionTaxRate = Number(e.target.value) || 0.044;
  };
  const clearBtn = document.getElementById("clearSelection");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
    });
  }
  $("#run").onclick = () => run();
  const shareSettingsBtn = document.getElementById("btnShareSettings");
  if (shareSettingsBtn) shareSettingsBtn.onclick = () => copyShareUrl();
  wireComparePanel();
  boot().catch((err) => {
    $("#result").innerHTML = `<div class="card pad empty">${err.message || err}</div>`;
  });
});

// ==== DIVIDEND MODE (v1) ====
// Separate engine: backtest() above is untouched (dividend-off results byte-identical).
// Uses ONLY raw price series (US: split-adjusted, dividends NOT adjusted · KR: raw .KS close)
// + real distribution events. 수정주가 + 분배금을 동시에 쓰면 이중계산 → basis 검사로 거부.
// Mirrors agents/build_backtest.py backtest_dividend() step by step (JS↔Py parity ≤1e-9).
const DIV_TAX_RATES = { US_DIRECT: 0.15, KR_LISTED: 0.154 };
const DIV_ALLOWED_BASIS = ["raw", "raw_split_adjusted"];
const DIV_REBAL_MODES = ["Q", "Y", "M", "N"];

function divFxAsOf(fxDates, fxVals, d) {
  // last USDKRW strictly before d (previous-day FX, no look-ahead) = bisect_left − 1
  let lo = 0,
    hi = fxDates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fxDates[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  return i >= 0 ? fxVals[i] : null;
}

function divMinusDays(d, n) {
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return new Date(t - n * 86400000).toISOString().slice(0, 10);
}

function divMonths(a, b) {
  let y = Number(a.slice(0, 4)),
    m = Number(a.slice(5, 7));
  const ey = Number(b.slice(0, 4)),
    em = Number(b.slice(5, 7));
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      y += 1;
      m = 1;
    }
  }
  return out;
}

function divEdgeWeekday(ym, last) {
  const y = Number(ym.slice(0, 4)),
    m = Number(ym.slice(5, 7));
  let t = last ? Date.UTC(y, m, 1) - 86400000 : Date.UTC(y, m - 1, 1);
  for (;;) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) break;
    t += last ? -86400000 : 86400000;
  }
  return new Date(t).toISOString().slice(0, 10);
}

function divShiftYm(ym, k) {
  const n = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + k;
  return `${String(Math.floor(n / 12)).padStart(4, "0")}-${String((n % 12) + 1).padStart(2, "0")}`;
}

function divInRanges(ym, ranges) {
  return (ranges || []).some((g) => g.from <= ym && ym <= g.to);
}

function backtestDividend(weights, data, start, end, rebalance, initialCapital = 1, monthlyContribution = 0, opts = {}) {
  const mode = opts.mode === "reinvest" ? "reinvest" : "cash";
  const cost = clampTradeCost(opts.cost != null ? opts.cost : TRADE_COST_DEFAULT);
  const taxRates = { ...DIV_TAX_RATES, ...(opts.taxRates || {}) };
  const bandOn = !!opts.bandOn;
  const bandPct = bandOn ? clampBandPct(opts.bandPct) : 0;
  const codes = Object.keys(weights).filter((c) => weights[c] > 0);
  if (!codes.length) return { error: "ETF를 선택하세요." };
  if (!DIV_REBAL_MODES.includes(rebalance)) return { error: "배당 모드는 고정 비중(분기·연·매월·없음)만 지원합니다." };
  for (const c of codes) {
    if (!data.prices[c]) return { error: `${c} 원가격 시세가 없습니다.` };
    if (!DIV_ALLOWED_BASIS.includes(data.basis[c]))
      return { error: `${c}: 배당 모드는 원가격(분배 미조정) 시계열만 허용합니다(수정주가+분배금 이중계산 방지).` };
  }
  const totalW = codes.reduce((s, c) => s + weights[c], 0);
  const tw = Object.fromEntries(codes.map((c) => [c, weights[c] / totalW]));
  const meta = data.meta;
  const isUs = Object.fromEntries(codes.map((c) => [c, (meta[c] || {}).market === "US"]));
  const fxDates = data.fx ? data.fx.map((r) => r[0]) : [];
  const fxVals = data.fx ? data.fx.map((r) => r[1]) : [];
  const anyUs = codes.some((c) => isUs[c]);
  if (anyUs && !fxDates.length) return { error: "USDKRW 환율 데이터가 없습니다." };

  const sets = codes.map((c) => new Set(Object.keys(data.prices[c]).filter((d) => d >= start && d <= end)));
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  if (anyUs) common = common.filter((d) => divFxAsOf(fxDates, fxVals, d) != null);
  if (common.length < 20) return { error: "선택한 ETF의 공통 기간이 너무 짧습니다." };
  const day0 = common[0],
    lastD = common[common.length - 1];

  const pk = {};
  const fxOn = {};
  for (const d of common) fxOn[d] = anyUs ? divFxAsOf(fxDates, fxVals, d) : 1.0;
  for (const c of codes) {
    const src = data.prices[c];
    pk[c] = {};
    for (const d of common) pk[c][d] = isUs[c] ? src[d] * fxOn[d] : src[d];
  }

  const evByCode = {};
  for (const c of codes) evByCode[c] = data.div[c].events.filter((e) => day0 < e.ex && e.ex <= lastD);
  const ptr = Object.fromEntries(codes.map((c) => [c, 0]));

  const q = (m) => Math.floor((Number(m) - 1) / 3);
  const isRebal = (prev, cur) => {
    if (rebalance === "N") return false;
    const py = prev.slice(0, 4),
      pm = prev.slice(5, 7),
      cy = cur.slice(0, 4),
      cm = cur.slice(5, 7);
    if (rebalance === "Y") return py !== cy;
    if (rebalance === "M") return prev.slice(0, 7) !== cur.slice(0, 7);
    return py !== cy || q(pm) !== q(cm);
  };
  const sumUnits = (u, d) => Object.keys(u).reduce((s, c) => s + u[c] * pk[c][d], 0);

  let units = Object.fromEntries(codes.map((c) => [c, (tw[c] * initialCapital) / pk[c][day0]]));
  let value = codes.reduce((s, c) => s + units[c] * pk[c][day0], 0);
  let invested = Number(initialCapital);
  let contributions = 1;
  let withdrawn = 0;
  let totalCost = 0;
  let rebalCount = 0,
    dcaCount = 0,
    reinvestCount = 0;
  let peakW = value,
    mdd = 0,
    peakH = value,
    mddH = 0;
  const eventsLog = [];
  const curve = [{ d: day0, v: value, w: value, inv: invested }];
  let prev = day0;
  for (const d of common.slice(1)) {
    value = codes.filter((c) => c in units).reduce((s, c) => s + units[c] * pk[c][d], 0);
    for (const c of codes) {
      const lst = evByCode[c];
      while (ptr[c] < lst.length && lst[ptr[c]].ex <= d) {
        const e = lst[ptr[c]];
        ptr[c] += 1;
        const u = units[c] || 0;
        if (!(u > 0)) continue;
        const fx = isUs[c] ? divFxAsOf(fxDates, fxVals, e.ex) : 1.0;
        const native = u * e.amt;
        const gross = native * fx;
        const prof = data.div[c].taxProfile || "KR_LISTED";
        const rate = Number(taxRates[prof] || 0);
        const tax = gross * rate;
        const net = gross - tax;
        const rec = { ex: e.ex, d, code: c, amt: e.amt, units: u, fx, native, gross, tax, net, src: e.src };
        if (mode === "cash") {
          withdrawn += net;
        } else {
          const cCost = 0.5 * net * cost;
          totalCost += cCost;
          units[c] = u + (net - cCost) / pk[c][d];
          value += net - cCost;
          reinvestCount += 1;
        }
        eventsLog.push(rec);
      }
    }
    const newMonth = prev.slice(0, 7) !== d.slice(0, 7);
    let doFull = bandOn ? false : isRebal(prev, d);
    let contrib = 0;
    if (monthlyContribution > 0 && newMonth) {
      contrib = Number(monthlyContribution);
      value += contrib;
      invested += contrib;
      contributions += 1;
    }
    if (!doFull && contrib > 0) {
      const wOld = currentWeights(units, pk, d, value);
      const newUnits = { ...units };
      dcaCount += 1;
      for (const [c, w] of Object.entries(tw)) {
        if (w > 0) newUnits[c] = (newUnits[c] || 0) + (contrib * w) / pk[c][d];
      }
      if (cost > 0) {
        const wNew = currentWeights(newUnits, pk, d, value);
        const to = oneWayTurnover(wOld, wNew);
        if (to > 0) {
          totalCost += value * to * cost;
          const k = 1 - to * cost;
          for (const c of Object.keys(newUnits)) newUnits[c] *= k;
        }
      }
      units = Object.fromEntries(Object.entries(newUnits).filter(([, u]) => u > 0));
      value = sumUnits(units, d);
    }
    if (bandOn && !doFull && bandDriftExceeds(units, pk, d, value, tw, bandPct)) doFull = true;
    if (doFull) {
      rebalCount += 1;
      const wOld = currentWeights(units, pk, d, value);
      if (cost > 0) {
        const to = oneWayTurnover(wOld, tw);
        if (to > 0) {
          const drag = value * to * cost;
          totalCost += drag;
          value -= drag;
        }
      }
      units = Object.fromEntries(codes.map((c) => [c, (tw[c] * value) / pk[c][d]]));
      value = codes.reduce((s, c) => s + units[c] * pk[c][d], 0);
    }
    const wealth = value + withdrawn;
    peakW = Math.max(peakW, wealth);
    mdd = Math.min(mdd, wealth / peakW - 1);
    peakH = Math.max(peakH, value);
    mddH = Math.min(mddH, value / peakH - 1);
    curve.push({ d, v: value, w: wealth, inv: invested });
    prev = d;
  }

  // ---- aggregation (label month = actual ex-date month) ----
  const months = divMonths(day0, lastD);
  const mrow = {};
  for (const ym of months) mrow[ym] = { ym, gross: 0, tax: 0, net: 0, count: 0, byCode: {} };
  for (const r of eventsLog) {
    const m = mrow[r.ex.slice(0, 7)];
    m.gross += r.gross;
    m.tax += r.tax;
    m.net += r.net;
    m.count += 1;
    const b = (m.byCode[r.code] ||= { gross: 0, tax: 0, net: 0, native: 0 });
    b.gross += r.gross;
    b.tax += r.tax;
    b.net += r.net;
    b.native += r.native;
  }
  const firstWd = divEdgeWeekday(months[0], false);
  const lastWd = divEdgeWeekday(months[months.length - 1], true);
  for (const ym of months) {
    const m = mrow[ym];
    const noData = [],
      unver = [];
    for (const c of codes) {
      const cov = data.div[c].coverage || {};
      if (ym < (cov.from || "0000").slice(0, 7) || ym > (cov.to || "9999").slice(0, 7)) noData.push(c);
      else if (divInRanges(ym, data.div[c].gaps)) unver.push(c);
    }
    let st;
    if (noData.length === codes.length) st = "no_data";
    else if (noData.length) st = "partial";
    else if (unver.length) st = "unverified";
    else st = "ok";
    m.status = st;
    if (noData.length) m.noData = noData;
    if (unver.length) m.unverified = unver;
    const inc = (ym === months[0] && day0 > firstWd) || (ym === months[months.length - 1] && lastD < lastWd);
    if (inc) m.inc = true;
  }
  const monthList = months.map((ym) => mrow[ym]);

  const years = [];
  const ys = [...new Set(months.map((ym) => ym.slice(0, 4)))].sort();
  let prevY = null;
  for (const y of ys) {
    const rows = months.filter((ym) => ym.slice(0, 4) === y).map((ym) => mrow[ym]);
    const g = rows.reduce((s, r) => s + r.gross, 0);
    const t = rows.reduce((s, r) => s + r.tax, 0);
    const n = rows.reduce((s, r) => s + r.net, 0);
    let usdNative = 0,
      usdKrw = 0;
    for (const r of eventsLog) {
      if (r.ex.slice(0, 4) === y && isUs[r.code]) {
        usdNative += r.native;
        usdKrw += r.gross;
      }
    }
    const yr = {
      y,
      gross: g,
      tax: t,
      net: n,
      count: rows.reduce((s, r) => s + r.count, 0),
      partial: (y === ys[0] && day0 > `${y}-01-07`) || (y === ys[ys.length - 1] && lastD < `${y}-12-24`),
      status: "ok",
    };
    const sts = new Set(rows.map((r) => r.status));
    if (sts.has("no_data") || sts.has("partial")) yr.status = "partial";
    else if (sts.has("unverified")) yr.status = "unverified";
    if (anyUs) {
      yr.usdGross = usdNative;
      yr.usdKrwGross = usdKrw;
      yr.fxBar = usdNative > 0 ? usdKrw / usdNative : null;
      if (prevY != null && !yr.partial && !prevY.partial && prevY.usdGross && usdNative > 0 && prevY.usdKrwGross > 0) {
        yr.growthKrwPct = usdKrw / prevY.usdKrwGross - 1;
        yr.growthUsdPct = usdNative / prevY.usdGross - 1;
        yr.fxEffectPct = yr.fxBar / prevY.fxBar - 1;
      }
    }
    years.push(yr);
    prevY = yr;
  }

  // TTM = last 12 COMPLETE calendar months by ex-date month (incomplete final month excluded)
  const lastM = months[months.length - 1];
  const endM = mrow[lastM].inc ? divShiftYm(lastM, -1) : lastM;
  const startM = divShiftYm(endM, -11);
  const ttmMonths = months.filter((ym) => startM <= ym && ym <= endM);
  const tt = eventsLog.filter((r) => startM <= r.ex.slice(0, 7) && r.ex.slice(0, 7) <= endM);
  const ttm = {
    from: startM,
    to: endM,
    gross: tt.reduce((s, r) => s + r.gross, 0),
    tax: tt.reduce((s, r) => s + r.tax, 0),
    net: tt.reduce((s, r) => s + r.net, 0),
    count: tt.length,
    short: months[0] > startM || (months[0] === startM && !!mrow[startM].inc),
    flags: [...new Set(ttmMonths.map((ym) => mrow[ym].status))].filter((s) => s !== "ok").sort(),
    label: "월평균 = TTM÷12",
  };
  ttm.monthlyAvg = ttm.net / 12;
  ttm.monthlyAvgGross = ttm.gross / 12;

  const byCode = {};
  for (const r of eventsLog) {
    const b = (byCode[r.code] ||= { gross: 0, tax: 0, net: 0, native: 0, count: 0 });
    b.gross += r.gross;
    b.tax += r.tax;
    b.net += r.net;
    b.native += r.native;
    b.count += 1;
  }

  const nDays = common.length - 1;
  const yrs = nDays / 252;
  const finalValue = value;
  const wealth = value + withdrawn;
  return {
    mode,
    basis: "ex_date",
    start: day0,
    end: lastD,
    days: nDays,
    years: yrs,
    codes,
    weights: tw,
    rebalance,
    initial: Number(initialCapital),
    monthly: Number(monthlyContribution),
    invested,
    contributions,
    finalValue,
    withdrawnNet: withdrawn,
    wealth,
    totalReturnIncl: wealth / invested - 1,
    holdingsReturn: finalValue / invested - 1,
    cagr: yrs > 0 ? Math.pow(wealth / invested, 1 / yrs) - 1 : 0,
    mdd,
    mddHoldings: mddH,
    costDrag: totalCost,
    rebalCount,
    dcaBuyCount: dcaCount,
    reinvestCount,
    taxRates,
    dividends: {
      months: monthList,
      years,
      ttm,
      byCode,
      totalGross: eventsLog.reduce((s, r) => s + r.gross, 0),
      totalTax: eventsLog.reduce((s, r) => s + r.tax, 0),
      totalNet: eventsLog.reduce((s, r) => s + r.net, 0),
      events: eventsLog,
    },
    curve,
  };
}

// ---- Dividend mode UI (data load + render). Strings: 과거 기준 톤, 권유·서열 표현 금지(reviewer 금지어 lint). ----
const DIV_PRESETS = {
  divSample: {
    label: "배당 포트폴리오(예시)",
    w: { SCHD: 35, VIG: 20, BND: 25, "161510": 20 },
    rebalance: "Y",
    mode: "cash",
    note: "커버드콜 제외 예시 조합(미국 직투 3종 + 국내상장 1종) · 권유 아님 · 공통 기간 2012-08~",
  },
  schdVsKr: {
    label: "SCHD 직투 vs 국내상장",
    compare: [
      { label: "SCHD (직투)", w: { SCHD: 100 } },
      { label: "SOL 미국배당다우존스", w: { "446720": 100 } },
      { label: "TIGER 미국배당다우존스", w: { "458730": 100 } },
      { label: "ACE 미국배당다우존스", w: { "402970": 100 } },
    ],
    start: "2023-08-01",
    rebalance: "N",
    mode: "cash",
    note: "같은 지수(다우존스 미국 배당100) 추종 비교 · ACE가 이 지수로 바뀐 2023-08부터 공통 · KODEX(489250)는 2024-08 상장이라 제외",
  },
};
const DIV_GROUPS = [
  ["KR", "국내상장 배당"],
  ["US", "해외 직투 비교"],
  ["ALL", "전체"],
];
const DIV_SAME_INDEX_KR = ["446720", "458730", "402970", "489250"];

const divState = {
  meta: null,
  data: { meta: {}, prices: {}, basis: {}, div: {}, fx: null },
  sel: {},
  group: "KR",
  mode: "cash",
  taxView: "after",
  preset: null,
  last: null,
  charts: [],
  booted: false,
};

async function divLoadMeta() {
  if (divState.meta) return divState.meta;
  const res = await fetch("./data/div_meta.json");
  if (!res.ok) throw new Error("data/div_meta.json 을 불러오지 못했습니다.");
  divState.meta = await res.json();
  return divState.meta;
}

function divEtf(code) {
  return (divState.meta?.etfs || []).find((e) => e.code === code) || null;
}

async function divEnsureData(codes) {
  const D = divState.data;
  const need = codes.filter((c) => !D.prices[c]);
  await Promise.all(
    need.map(async (c) => {
      const m = divEtf(c);
      if (!m) throw new Error(`배당 모드 미지원 종목: ${c}`);
      const [pr, dr] = await Promise.all([fetch("./" + m.priceFile), fetch("./" + m.divFile)]);
      if (!pr.ok || !dr.ok) throw new Error(`${c} 데이터 파일을 불러오지 못했습니다.`);
      const pj = await pr.json();
      const dj = await dr.json();
      D.meta[c] = m;
      D.basis[c] = pj.priceBasis;
      D.prices[c] = Object.fromEntries(pj.rows.map((r) => [r[0], r[1]]));
      D.div[c] = dj;
    })
  );
  if (!D.fx && codes.some((c) => divEtf(c)?.market === "US")) {
    const res = await fetch("./" + (divState.meta.fx?.file || "data/fx/USDKRW.json"));
    if (!res.ok) throw new Error("USDKRW 환율 파일을 불러오지 못했습니다.");
    const fj = await res.json();
    D.fx = fj.rows.map((r) => [r[0], r[1]]);
  }
}

function divBadges(e) {
  let h = "";
  if (e.market === "US") h += `<span class="etf-badge us">미국 직투</span>`;
  if (e.coveredCall) h += `<span class="etf-badge cc" title="분배금에 옵션 프리미엄·원금 성격 포함 가능">커버드콜</span>`;
  if (e.gaps && e.gaps.length) h += `<span class="etf-badge unv" title="미확인 구간 있음">미확인 ${e.gaps.length}</span>`;
  return h ? `<span class="etf-badges">${h}</span>` : "";
}

function divRenderGroupTabs() {
  const box = $("#divGroupTabs");
  if (!box) return;
  box.innerHTML = "";
  for (const [k, label] of DIV_GROUPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (divState.group === k ? " active" : "");
    b.textContent = label;
    b.setAttribute("role", "tab");
    b.onclick = () => {
      divState.group = k;
      divRenderGroupTabs();
      divRenderList();
    };
    box.appendChild(b);
  }
}

function divRenderPresets() {
  const box = $("#divPresets");
  if (!box) return;
  box.innerHTML = "";
  for (const [k, p] of Object.entries(DIV_PRESETS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (divState.preset === k ? " active" : "");
    b.dataset.key = k;
    b.textContent = p.label;
    b.title = p.note || "";
    b.onclick = () => divApplyPreset(k);
    box.appendChild(b);
  }
}

function divRenderList() {
  const box = $("#divEtfList");
  if (!box || !divState.meta) return;
  box.innerHTML = "";
  const list = divState.meta.etfs.filter((e) => divState.group === "ALL" || e.market === divState.group);
  for (const e of list) {
    const on = e.code in divState.sel;
    const el = document.createElement("div");
    el.className = "etf" + (on ? " on" : "");
    el.setAttribute("data-div-etf", e.code);
    const freq = { M: "월", Q: "분기", S: "반기", A: "연" }[e.frequency] || e.frequency;
    const vf = e.validFrom ? ` · 지수 기준 ${e.validFrom.slice(0, 7)}~` : "";
    el.innerHTML = `<div class="etf-head"><input type="checkbox" ${on ? "checked" : ""} aria-label="${e.code} 선택" /><div><div class="etf-name">${e.name}${divBadges(e)}</div><div class="etf-code">${e.code} · ${e.group} · ${freq}분배 · ${e.start}~${vf}</div></div><span class="cat">${e.category}</span></div><div class="weight-row" style="${on ? "" : "display:none"}"><input type="range" min="0" max="100" value="${divState.sel[e.code] || 0}" /><div class="wnum">${divState.sel[e.code] || 0}%</div></div>`;
    el.querySelector("input[type=checkbox]").onchange = (ev) => {
      if (ev.target.checked) divState.sel[e.code] = 10;
      else delete divState.sel[e.code];
      divState.preset = null;
      divRenderPresets();
      divRenderList();
    };
    el.querySelector("input[type=range]").oninput = (ev) => {
      const w = Number(ev.target.value);
      if (w <= 0) delete divState.sel[e.code];
      else divState.sel[e.code] = w;
      el.querySelector(".wnum").textContent = w + "%";
      divState.preset = null;
      divUpdateSum();
    };
    box.appendChild(el);
  }
  divUpdateSum();
}

function divUpdateSum() {
  const s = Object.values(divState.sel).reduce((a, b) => a + b, 0);
  const n = Object.keys(divState.sel).length;
  const el = $("#divSum");
  if (el) el.textContent = `선택 ${n}종 · 비중 합 ${s}%`;
}

function divReadControls() {
  divState.mode = document.querySelector("input[name=divMode]:checked")?.value === "reinvest" ? "reinvest" : "cash";
  divState.taxView = document.querySelector("input[name=divTaxView]:checked")?.value === "pre" ? "pre" : "after";
  return {
    period: $("#divPeriod")?.value || "max",
    rebalance: $("#divRebalance")?.value || "N",
    start: $("#divStart")?.value || "",
    end: $("#divEnd")?.value || "",
    bandOn: !!$("#divBandOn")?.checked,
    bandPct: Math.max(1, Math.min(10, Number($("#divBandPct")?.value) || 5)) / 100,
    initial: Math.max(10000, Number($("#divInitial")?.value) || 100000000),
    monthly: Math.max(0, Number($("#divMonthly")?.value) || 0),
  };
}

function divWindow(codes, ctl, forcedStart) {
  const ends = codes.map((c) => divEtf(c)?.end || "2099-12-31").sort();
  const lastEnd = ends[0];
  let start = "2000-01-01",
    end = "2099-12-31";
  if (ctl.period === "custom") {
    if (ctl.start) start = ctl.start;
    if (ctl.end) end = ctl.end;
  } else if (ctl.period !== "max") {
    const n = { "10y": 10, "5y": 5, "3y": 3, "1y": 1 }[ctl.period] || 0;
    start = `${Number(lastEnd.slice(0, 4)) - n}${lastEnd.slice(4)}`;
  }
  if (forcedStart && forcedStart > start) start = forcedStart;
  return { start, end };
}

function divSetRadio(name, v) {
  const el = document.querySelector(`input[name=${name}][value=${v}]`);
  if (el) el.checked = true;
}

async function divApplyPreset(key) {
  const p = DIV_PRESETS[key];
  if (!p) return;
  divState.preset = key;
  const first = p.compare ? p.compare[0].w : p.w;
  divState.sel = { ...first };
  if (p.compare) divState.group = "ALL";
  else if (Object.keys(p.w).some((c) => divEtf(c)?.market === "US")) divState.group = "ALL";
  const rb = $("#divRebalance");
  if (rb) rb.value = p.rebalance || "N";
  divSetRadio("divMode", p.mode || "cash");
  divRenderPresets();
  divRenderGroupTabs();
  divRenderList();
  await divRun();
}

async function divRun() {
  const host = $("#divResult");
  try {
    await divLoadMeta();
    const ctl = divReadControls();
    const p = divState.preset ? DIV_PRESETS[divState.preset] : null;
    const opts = { mode: divState.mode, bandOn: ctl.bandOn, bandPct: ctl.bandPct, cost: clampTradeCost(state.tradeCost) };
    if (p && p.compare) {
      const codes = [...new Set(p.compare.flatMap((l) => Object.keys(l.w)))];
      await divEnsureData(codes);
      // common window across ALL legs (same dates for a fair side-by-side)
      const firsts = codes.map((c) => divEtf(c).start).sort();
      const win = divWindow(codes, ctl, [p.start || "", firsts[firsts.length - 1]].sort()[1]);
      const runLegs = (s0, e0) =>
        p.compare.map((l) => ({
          label: l.label,
          w: l.w,
          r: backtestDividend(l.w, divState.data, s0, e0, ctl.rebalance, ctl.initial, ctl.monthly, opts),
        }));
      let legs = runLegs(win.start, win.end);
      // align every leg to the same first/last date (KR/US holidays and data gaps differ)
      const okL = legs.filter((l) => !l.r.error);
      if (okL.length) {
        const s1 = okL.map((l) => l.r.start).sort().at(-1);
        const e1 = okL.map((l) => l.r.end).sort()[0];
        if (okL.some((l) => l.r.start !== s1 || l.r.end !== e1)) legs = runLegs(s1, e1);
      }
      divState.last = { compare: true, legs, preset: p, ctl };
      divRenderCompare(host, legs, p, ctl);
      return;
    }
    const codes = Object.keys(divState.sel).filter((c) => divState.sel[c] > 0);
    if (!codes.length) {
      host.innerHTML = `<div class="card pad empty">종목을 선택하세요.</div>`;
      return;
    }
    await divEnsureData(codes);
    const win = divWindow(codes, ctl, null);
    const r = backtestDividend({ ...divState.sel }, divState.data, win.start, win.end, ctl.rebalance, ctl.initial, ctl.monthly, opts);
    divState.last = { compare: false, r, ctl };
    if (r.error) {
      host.innerHTML = `<div class="card pad empty">${r.error}</div>`;
      return;
    }
    divRenderSingle(host, r, ctl);
  } catch (e) {
    console.warn(e);
    host.innerHTML = `<div class="card pad empty">배당 데이터 오류: ${e.message || e}</div>`;
  }
}

function divDestroyCharts() {
  for (const c of divState.charts) {
    try {
      c.destroy();
    } catch (_) {
      /* ignore */
    }
  }
  divState.charts = [];
}

function divHatch(color) {
  const cv = document.createElement("canvas");
  cv.width = 8;
  cv.height = 8;
  const g = cv.getContext("2d");
  if (!g) return color;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 8);
  g.lineTo(8, 0);
  g.stroke();
  return g.createPattern(cv, "repeat");
}

function divMonthVal(m, view) {
  return view === "pre" ? m.gross : m.net;
}

function divStatusLabel(st) {
  return { ok: "", no_data: "데이터 없음", partial: "일부 종목 데이터 없음", unverified: "미확인 포함" }[st] || st;
}

function divMonthlyChart(canvas, series, view) {
  // series: [{label, months, color}] — 0 = 확인된 무분배, 회색 = 데이터 없음, 빗금 = 미확인
  if (typeof Chart === "undefined" || !canvas) return null;
  const labels = series[0].months.map((m) => m.ym);
  let max = 0;
  for (const s of series) for (const m of s.months) max = Math.max(max, divMonthVal(m, view));
  const stub = max > 0 ? max * 0.06 : 1;
  const ds = [];
  const single = series.length === 1;
  series.forEach((s, i) => {
    ds.push({
      label: single ? (view === "pre" ? "세전 분배금" : "세후 분배금") : s.label,
      data: s.months.map((m) => (m.status === "no_data" ? 0 : divMonthVal(m, view))),
      backgroundColor: s.color,
      stack: single ? "a" : "s" + i,
      _kind: "val",
    });
    ds.push({
      label: single ? "미확인(0 아님)" : `${s.label} 미확인`,
      data: s.months.map((m) => (m.status === "unverified" || m.status === "partial" ? stub : 0)),
      backgroundColor: divHatch("#f0c27a"),
      borderColor: "#f0c27a",
      borderWidth: 1,
      stack: single ? "a" : "s" + i,
      _kind: "unv",
    });
    ds.push({
      label: single ? "데이터 없음" : `${s.label} 데이터 없음`,
      data: s.months.map((m) => (m.status === "no_data" ? stub : 0)),
      backgroundColor: "#4a5563",
      stack: single ? "a" : "s" + i,
      _kind: "nodata",
    });
  });
  return new Chart(canvas, {
    type: "bar",
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          labels: { color: "#8b9aab", boxWidth: 12, filter: (it, data) => data.datasets[it.datasetIndex]._kind === "val" || single },
        },
        tooltip: {
          filter: (it) => it.raw > 0,
          callbacks: {
            label: (it) => {
              const d = it.dataset;
              const s = series[single ? 0 : Math.floor(it.datasetIndex / 3)];
              const m = s.months[it.dataIndex];
              if (d._kind === "nodata") return `${s.label}: 데이터 없음`;
              if (d._kind === "unv") return `${s.label}: ${divStatusLabel(m.status)} ${(m.unverified || m.noData || []).join(",")}`;
              return `${d.label}: ${won(it.raw)}${m.inc ? " (부분 월)" : ""}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#667687", maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
        y: { stacked: true, ticks: { color: "#667687", callback: (v) => (v >= 1e4 ? Math.round(v / 1e4).toLocaleString("ko-KR") + "만" : v) }, grid: { color: "rgba(255,255,255,.05)" } },
      },
    },
  });
}

function divFmtPct(x) {
  return x == null || Number.isNaN(x) ? "—" : pct(x, 1);
}

function divYearsTable(r) {
  const anyUs = r.codes.some((c) => divEtf(c)?.market === "US");
  const rows = r.dividends.years
    .slice()
    .reverse()
    .map((y) => {
      const flags = [];
      if (y.partial) flags.push("부분 연도");
      if (y.status === "unverified") flags.push("미확인 포함");
      if (y.status === "partial") flags.push("데이터 없음 포함");
      if (y.gross > 20000000) flags.push("세전 2,000만원 초과");
      const fx = anyUs
        ? `<td class="num">${divFmtPct(y.growthUsdPct)}</td><td class="num">${divFmtPct(y.fxEffectPct)}</td><td class="num">${divFmtPct(y.growthKrwPct)}</td>`
        : "";
      return `<tr><td>${y.y}</td><td class="num">${won(y.gross)}</td><td class="num">${won(y.tax)}</td><td class="num">${won(y.net)}</td><td class="num">${y.count}</td>${fx}<td>${flags.join(" · ")}</td></tr>`;
    })
    .join("");
  const fxHead = anyUs ? `<th class="num">달러 증감</th><th class="num">환율 효과</th><th class="num">원화 증감</th>` : "";
  const fxNote = anyUs
    ? `<div class="warn">미국 직투분: (1+원화 증감) = (1+달러 증감) × (1+환율 효과). 환율 효과 = 분배금 가중 평균 환율의 전년 대비 변화. 달러 증감에는 보유 수량 변화(재투자·적립) 포함. 부분 연도는 증감 생략.</div>`
    : "";
  return `<div class="card pad"><div class="section-title">연도별 분배금 합계 (배당락일 기준 집계)</div><div class="table-scroll"><table class="div-table"><thead><tr><th>연도</th><th class="num">세전</th><th class="num">세금</th><th class="num">세후</th><th class="num">건수</th>${fxHead}<th>비고</th></tr></thead><tbody>${rows}</tbody></table></div>${fxNote}</div>`;
}

function divByCodeTable(r) {
  const rows = r.codes
    .map((c) => {
      const e = divEtf(c) || {};
      const b = r.dividends.byCode[c] || { gross: 0, tax: 0, net: 0, count: 0 };
      const rate = e.taxProfile === "US_DIRECT" ? r.taxRates.US_DIRECT : r.taxRates.KR_LISTED;
      const gaps = (e.gaps || []).map((g) => (g.from === g.to ? g.from : `${g.from}~${g.to}`)).join(", ");
      const d = divState.data.div[c] || {};
      const src = (d.sources || []).join("/");
      return `<tr><td>${e.name || c}<div class="etf-code">${c}${e.coveredCall ? " · 커버드콜" : ""}</div></td><td class="num">${(r.weights[c] * 100).toFixed(0)}%</td><td class="num">${b.count}</td><td class="num">${won(b.gross)}</td><td class="num">${won(b.tax)} (${(rate * 100).toFixed(1)}%)</td><td class="num">${won(b.net)}</td><td>${src}<div class="etf-code">범위 ${d.coverage?.from || "?"}~${d.coverage?.to || "?"}${gaps ? " · 미확인 " + gaps : ""}</div></td></tr>`;
    })
    .join("");
  return `<div class="card pad"><div class="section-title">종목별 분배금 (기간 합계)</div><div class="table-scroll"><table class="div-table"><thead><tr><th>종목</th><th class="num">비중</th><th class="num">건수</th><th class="num">세전</th><th class="num">세금</th><th class="num">세후</th><th>출처 · 데이터 범위</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function divNotes(codes, r) {
  const notes = [
    "배당락일 기준 집계: 분배금은 배당락일이 속한 달로 묶었습니다(실제 지급일은 보통 미국 3–5일, 국내 1–5일 뒤).",
    "일반계좌 가정 · ISA·연금계좌 미반영. 미국 직투 분배금은 미국 원천징수 15%만 반영(국내 배당소득세율 14% < 15%라 추가 징수 없음 가정), 국내상장 ETF 분배금은 15.4% 단순 적용.",
    "2025.1부터 국내상장 해외 ETF는 외국납부세액을 펀드 단계 환급 대신 투자자 원천징수 단계에서 차감하는 방식으로 바뀌었습니다. 일반계좌 결과는 대체로 비슷하지만 실제 세액은 ETF별 외국납부세액·주당 과세표준액 기준으로 달라질 수 있습니다.",
    "매매차익 세금은 이 시뮬에 반영하지 않았습니다: 해외 직투는 연 250만원 기본공제 후 양도소득세 22%, 국내상장 해외형은 매매차익(과표 기준)에 배당소득세 15.4%, 국내주식형은 매매차익 비과세.",
    "연간 금융소득(이자+배당)이 2,000만원을 넘으면 금융소득종합과세 대상입니다(이 시뮬은 계산하지 않고 안내만).",
    "환율: 배당락일 전 영업일 USDKRW(FRED DEXKOUS, 최근분 Yahoo 보완)로 원화 환산, 평가도 전일 환율(룩어헤드 없음). 환전 수수료·정수 주·지급 시차는 반영하지 않았습니다.",
    "막대 0 = 데이터 범위 안에서 확인된 무분배 달, 회색 = 데이터 없음, 빗금 = 미확인(정기 일정상 있어야 하나 소스 간 확인 불가 — 0으로 채우지 않음).",
    r.mode === "cash"
      ? "인출 모드: 세후 분배금은 배당락일에 포트폴리오에서 빠져 현금으로 쌓입니다(이자 없음). 총수익률 = (기말 평가액 + 누적 세후 분배금) ÷ 투입 원금 − 1. MDD는 평가액+누적 분배금 기준."
      : "재투자 모드: 세후 분배금으로 배당락일(반영일) 종가에 같은 종목을 추가 매수합니다(비용 0.5×금액×거래비용률).",
  ];
  if (codes.some((c) => divEtf(c)?.coveredCall))
    notes.push("커버드콜(JEPI·JEPQ·KODEX 미국배당커버드콜액티브) 분배금에는 옵션 프리미엄·원금 성격이 포함될 수 있어 분배 규모가 총수익을 뜻하지 않습니다.");
  if (codes.includes("SCHD") || codes.some((c) => DIV_SAME_INDEX_KR.includes(c)))
    notes.push("SCHD(직투)와 SOL·TIGER·ACE·KODEX 미국배당다우존스는 같은 지수를 추종하지만 공통 기간이 짧습니다: SOL 2022-11~, TIGER 2023-06~, ACE는 2023-08부터 이 지수(이전 S&P 미국고배당), KODEX 2024-08~. 공통 비교는 2023-08 이후(KODEX 포함 시 2024-09 이후)만 의미가 있고, 짧은 기간 결과를 일반화하기 어렵습니다.");
  if (codes.includes("402970") && r.start < "2023-08-01")
    notes.push("ACE 미국배당다우존스(402970)는 2023-07까지 다른 지수(S&P 미국고배당)를 추종했습니다 — 이 구간은 다우존스 배당100 비교로 부적합합니다.");
  const unv = codes.filter((c) => (divEtf(c)?.gaps || []).length);
  if (unv.length) notes.push(`미확인 구간이 있는 종목: ${unv.map((c) => `${c}(${divEtf(c).gaps.map((g) => (g.from === g.to ? g.from : g.from + "~" + g.to)).join(", ")})`).join(" · ")}.`);
  return `<div class="card pad"><div class="section-title">세금 · 데이터 가정 (각주)</div><ul class="div-notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul><div class="warn">과거 시뮬 · 투자 자문 아님 · 과거 분배금은 미래 분배금을 보장하지 않습니다.</div></div>`;
}

function divKpis(r, view) {
  const t = r.dividends.ttm;
  const avg = view === "pre" ? t.monthlyAvgGross : t.monthlyAvg;
  const tot = view === "pre" ? t.gross : t.net;
  const tag = view === "pre" ? "세전" : "세후";
  const ttmFlag = t.short ? " · 기간이 12개월 미만" : t.flags.length ? " · " + t.flags.map(divStatusLabel).join("/") : "";
  const k = (label, val, sub, klass = "") => `<div class="card kpi"><div class="label">${label}</div><div class="val ${klass}">${val}</div><div class="sub2">${sub}</div></div>`;
  return `<div class="kpis div-kpis">${k(
    `TTM 월평균(${tag})`,
    won(avg),
    `월평균 = TTM÷12 · 과거 기준 월 ${won(avg)} 수준이었다${ttmFlag}`
  )}${k(`TTM 합계(${tag})`, won(tot), `최근 완결 12개월 ${t.from}~${t.to}(배당락월 기준) · ${t.count}건`)}${k(
    "누적 분배금(세후)",
    won(r.dividends.totalNet),
    `세전 ${won(r.dividends.totalGross)} · 세금 ${won(r.dividends.totalTax)}`
  )}${k("총수익률(분배 포함)", pct(r.totalReturnIncl, 1), `연환산 ${pct(r.cagr, 2)} · 가격만 ${pct(r.holdingsReturn, 1)}`, cls(r.totalReturnIncl))}${k(
    "MDD",
    pct(r.mdd, 1),
    r.mode === "cash" ? `평가액+누적 분배금 기준 · 평가액만 ${pct(r.mddHoldings, 1)}` : "평가액 기준(재투자)",
    "neg"
  )}${k("기말 평가액", won(r.finalValue), `투입 ${won(r.invested)}${r.mode === "cash" ? ` · 인출 누적 ${won(r.withdrawnNet)}` : ""}`)}</div>`;
}

function divRenderSingle(host, r, ctl) {
  divDestroyCharts();
  const view = divState.taxView;
  const modeLabel = r.mode === "cash" ? "인출" : "재투자";
  const rbl = { Q: "분기", Y: "연 1회", M: "매월", N: "없음" }[r.rebalance];
  const port = r.codes.map((c) => `${divEtf(c)?.name || c} ${(r.weights[c] * 100).toFixed(0)}%`).join(" · ");
  const p = divState.preset ? DIV_PRESETS[divState.preset] : null;
  host.innerHTML = `<div class="card pad div-head"><div class="section-title">분배금 흐름 · 과거 시뮬 (원가격 + 실제 분배금)</div><div class="div-port">${port}</div><div class="muted-note" style="margin:6px 0 0">기간 ${r.start} ~ ${r.end} · ${r.years.toFixed(1)}년 · 분배금 ${modeLabel} · 리밸런싱 ${rbl} · 시작 ${won(r.initial)}${r.monthly > 0 ? ` + 매월 ${won(r.monthly)}` : ""}${p ? " · " + p.note : ""}</div></div>${divKpis(
    r,
    view
  )}<div class="card chart-wrap div-chart"><div class="chart-title">월별 분배금 (${view === "pre" ? "세전" : "세후"} · 배당락일 기준 집계)</div><div class="chart-box"><canvas id="divMonthlyChart"></canvas></div><div class="div-legend"><span><i class="lg-val"></i>분배금</span><span><i class="lg-unver"></i>미확인·일부 데이터 없음(0 아님)</span><span><i class="lg-nodata"></i>데이터 없음</span><span>막대 없음 = 확인된 무분배</span></div></div>${divYearsTable(r)}${divByCodeTable(r)}${divNotes(r.codes, r)}`;
  const ch = divMonthlyChart($("#divMonthlyChart"), [{ label: "포트폴리오", months: r.dividends.months, color: "#7dd3c0" }], view);
  if (ch) divState.charts.push(ch);
}

function divRenderCompare(host, legs, p, ctl) {
  divDestroyCharts();
  const view = divState.taxView;
  const ok = legs.filter((l) => !l.r.error);
  if (!ok.length) {
    host.innerHTML = `<div class="card pad empty">${legs[0].r.error}</div>`;
    return;
  }
  const r0 = ok[0].r;
  const colors = ["#7dd3c0", "#f0c27a", "#9ecbff", "#ff9fb0"];
  const tag = view === "pre" ? "세전" : "세후";
  const cell = (l, f) => (l.r.error ? `<td>${l.r.error}</td>` : `<td class="num">${f(l.r)}</td>`);
  const row = (name, f) => `<tr><td>${name}</td>${legs.map((l) => cell(l, f)).join("")}</tr>`;
  const tbl = `<div class="table-scroll"><table class="div-table"><thead><tr><th>과거 기준</th>${legs.map((l, i) => `<th class="num"><i class="lg-dot" style="background:${colors[i]}"></i>${l.label}</th>`).join("")}</tr></thead><tbody>${[
    row(`TTM 월평균(${tag}) · 월평균 = TTM÷12`, (r) => won(view === "pre" ? r.dividends.ttm.monthlyAvgGross : r.dividends.ttm.monthlyAvg)),
    row(`TTM 합계(${tag})`, (r) => won(view === "pre" ? r.dividends.ttm.gross : r.dividends.ttm.net)),
    row("누적 분배금(세후)", (r) => won(r.dividends.totalNet)),
    row("세율(일반계좌 가정)", (r) => (divEtf(r.codes[0])?.taxProfile === "US_DIRECT" ? "15% (미국 원천)" : "15.4%")),
    row("총수익률(분배 포함)", (r) => pct(r.totalReturnIncl, 1)),
    row("가격만 수익률", (r) => pct(r.holdingsReturn, 1)),
    row("연환산", (r) => pct(r.cagr, 2)),
    row("MDD", (r) => pct(r.mdd, 1)),
  ].join("")}</tbody></table></div>`;
  host.innerHTML = `<div class="card pad div-head"><div class="section-title">${p.label} · 과거 시뮬 (같은 기간 나란히)</div><div class="muted-note" style="margin:6px 0 0">공통 기간 ${r0.start} ~ ${r0.end} · ${r0.years.toFixed(1)}년 · 각 ${won(ctl.initial)} 일괄 · 분배금 ${r0.mode === "cash" ? "인출" : "재투자"} · ${p.note}. 우열 판단용이 아니며 기간이 짧습니다.</div>${tbl}</div><div class="card chart-wrap div-chart"><div class="chart-title">월별 분배금 (${tag} · 배당락일 기준 집계)</div><div class="chart-box"><canvas id="divMonthlyChart"></canvas></div><div class="div-legend"><span><i class="lg-unver"></i>미확인(0 아님)</span><span><i class="lg-nodata"></i>데이터 없음</span></div></div>${ok
    .map((l) => divYearsTable(l.r).replace("연도별 분배금 합계 (배당락일 기준 집계)", `연도별 분배금 합계 · ${l.label} (배당락일 기준 집계)`))
    .join("")}${divNotes([...new Set(ok.flatMap((l) => l.r.codes))], r0)}`;
  const ch = divMonthlyChart(
    $("#divMonthlyChart"),
    ok.map((l) => ({ label: l.label, months: l.r.dividends.months, color: colors[legs.indexOf(l)] })),
    view
  );
  if (ch) divState.charts.push(ch);
}

async function divShowMode(mode) {
  const isDiv = mode === "div";
  const pl = $("#priceLayout"),
    dl = $("#divLayout");
  if (!pl || !dl) return;
  pl.hidden = isDiv;
  dl.hidden = !isDiv;
  const bp = $("#modePrice"),
    bd = $("#modeDiv");
  bp?.classList.toggle("active", !isDiv);
  bd?.classList.toggle("active", isDiv);
  bp?.setAttribute("aria-selected", String(!isDiv));
  bd?.setAttribute("aria-selected", String(isDiv));
  if (isDiv && !divState.booted) {
    divState.booted = true;
    try {
      const m = await divLoadMeta();
      const note = $("#divDataNote");
      if (note)
        note.textContent = `배당 데이터 생성 ${m.generatedAt} · 환율 ${m.fx.from}~${m.fx.to} (FRED ~${m.fx.fredLast}, 이후 Yahoo). 국내 분배금 = KRX KIND 공시, 미국 = 발행사·Nasdaq·stockanalysis·Yahoo 대조.`;
      divRenderPresets();
      divRenderGroupTabs();
      divRenderList();
    } catch (e) {
      $("#divResult").innerHTML = `<div class="card pad empty">배당 데이터 오류: ${e.message || e}</div>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const bp = $("#modePrice"),
    bd = $("#modeDiv");
  if (!bp || !bd) return;
  bp.onclick = () => divShowMode("price");
  bd.onclick = () => divShowMode("div");
  const per = $("#divPeriod");
  if (per) per.onchange = () => ($("#divCustomRow").hidden = per.value !== "custom");
  $("#divRun").onclick = () => divRun();
  $("#divClear").onclick = () => {
    divState.sel = {};
    divState.preset = null;
    divRenderPresets();
    divRenderList();
  };
  document.querySelectorAll("input[name=divTaxView]").forEach((el) => {
    el.onchange = () => {
      divReadControls();
      const L = divState.last;
      if (!L) return;
      if (L.compare) divRenderCompare($("#divResult"), L.legs, L.preset, L.ctl);
      else if (!L.r.error) divRenderSingle($("#divResult"), L.r, L.ctl);
    };
  });
  document.querySelectorAll("input[name=divMode]").forEach((el) => {
    el.onchange = () => divState.last && divRun();
  });
  // #div or #div=<presetKey> opens dividend mode directly
  const m = /(?:^#|[#&])div(?:=([A-Za-z0-9_]+))?(?:&|$)/.exec(location.hash || "");
  if (m) {
    divShowMode("div").then(() => {
      if (m[1] && DIV_PRESETS[m[1]]) divApplyPreset(m[1]);
    });
  }
});
