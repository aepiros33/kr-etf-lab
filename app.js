/** Exported for reviewer parity docs; weights must sum to 100. */
const PRESETS = {
  kAllWeather: {
    label: "🛡️ K-올웨더",
    w: {
      "069500": 15,
      "360750": 17.5,
      "453850": 17.5,
      "148070": 15,
      "411060": 15,
      "423160": 20,
    },
  },
  permanent: {
    label: "🏛️ 영구 포트폴리오",
    w: {
      "069500": 12.5,
      "360750": 12.5,
      "148070": 12.5,
      "453850": 12.5,
      "411060": 25,
      "423160": 25,
    },
  },
  global6040: {
    label: "📈 글로벌 60/40",
    w: {
      "360750": 40,
      "069500": 20,
      "453850": 20,
      "148070": 20,
    },
  },
  monthlyIncome: {
    label: "💵 월배당 인컴형",
    w: {
      "458730": 40,
      "329200": 20,
      "214980": 20,
      "441640": 20,
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

const state = {
  meta: null,
  prices: {},
  selected: {},
  period: "5y",
  rebalance: "Q",
  chart: null,
  search: "",
  category: "전체",
  dcaOn: false,
  initialCapital: 10_000_000,
  monthlyAmount: 500_000,
  loadingPrices: false,
  totalReturn: false,
  accountType: "taxable",
  pensionTaxRate: 0.044,
};
const $ = (s) => document.querySelector(s);

function pct(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  const v = (n * 100).toFixed(digits);
  return (n > 0 ? "+" : "") + v + "%";
}
function cls(n) {
  if (n == null || Number.isNaN(n)) return "";
  return n >= 0 ? "pos" : "neg";
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

/** Clone price map and compound daily yield into synthetic TR series (backtest only). */
function buildTotalReturnPrices(priceMap, codes) {
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
    state.prices = Object.fromEntries(
      Object.entries(bundle.prices || {}).map(([code, rows]) => [
        code,
        Object.fromEntries(rows.map((r) => [r.d, r.c])),
      ])
    );
  } else if (meta.prices) {
    state.prices = Object.fromEntries(
      Object.entries(meta.prices).map(([code, rows]) => [
        code,
        Object.fromEntries(rows.map((r) => [r.d, r.c])),
      ])
    );
  }

  state.meta = meta;
  $("#stamp").textContent = `시세 갱신 ${meta.generatedAt}\n${meta.source}\n메타 ${meta.etfs.length}종`;
  renderPresets();
  renderCatFilters();
  renderList();
  await applyPreset("kAllWeather");
}

function renderPresets() {
  const box = $("#presets");
  box.innerHTML = "";
  Object.entries(PRESETS).forEach(([k, p]) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.key = k;
    b.textContent = p.label;
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

async function applyPreset(key) {
  document.querySelectorAll("#presets .chip").forEach((el) =>
    el.classList.toggle("active", el.dataset.key === key)
  );
  state.selected = {};
  const codes = Object.keys(PRESETS[key].w);
  await ensurePrices(codes);
  Object.entries(PRESETS[key].w).forEach(([code, val]) => {
    if (state.meta.etfs.some((e) => e.code === code)) state.selected[code] = val;
  });
  renderList();
  await run();
}

function filteredEtfs() {
  const q = state.search.trim().toLowerCase();
  return state.meta.etfs.filter((etf) => {
    if (state.category !== "전체" && etf.category !== state.category) return false;
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
    const levTag = etf.leveraged ? " · 레버리지/인버스" : "";
    el.innerHTML = `<div class="etf-head"><input type="checkbox" ${on ? "checked" : ""} data-code="${etf.code}" /><div><div class="etf-name">${etf.name}</div><div class="etf-code">${etf.code} · ${etf.issuer}${levTag} · ${etf.start || "?"}~</div></div><span class="cat">${etf.category}</span></div><div class="weight-row" style="${on ? "" : "display:none"}"><input type="range" min="0" max="100" value="${state.selected[etf.code] || 0}" data-range="${etf.code}" /><div class="wnum">${state.selected[etf.code] || 0}%</div></div>`;
    el.querySelector("input[type=checkbox]").onchange = async (e) => {
      if (e.target.checked) {
        await ensurePrices([etf.code]);
        state.selected[etf.code] = 10;
      } else delete state.selected[etf.code];
      renderList();
    };
    const range = el.querySelector("input[type=range]");
    if (range)
      range.oninput = (e) => {
        state.selected[etf.code] = Number(e.target.value);
        el.querySelector(".wnum").textContent = e.target.value + "%";
        updateSum();
        updateIrpWarn();
      };
    box.appendChild(el);
  });
  updateSum();
  updateIrpWarn();
}

function updateSum() {
  const sum = Object.values(state.selected).reduce((a, b) => a + b, 0);
  $("#sum").textContent = `비중 합 ${sum}%`;
  $("#sum").style.color = Math.abs(sum - 100) < 1e-6 ? "var(--accent)" : "var(--accent2)";
}

/** Selective price loader: selected tickers + benchmark only. */
async function ensurePrices(codes) {
  const need = [...new Set([...codes, BENCH])].filter((c) => !state.prices[c]);
  if (!need.length) return;
  state.loadingPrices = true;
  try {
    const loaded = await Promise.all(
      need.map(async (code) => {
        try {
          const res = await fetch(`./data/prices/${code}.json`);
          if (!res.ok) return null;
          const rows = await res.json();
          return [code, Object.fromEntries(rows.map((r) => [r.d, r.c]))];
        } catch {
          return null;
        }
      })
    );
    let missing = [];
    loaded.forEach((pair, i) => {
      if (pair) state.prices[pair[0]] = pair[1];
      else missing.push(need[i]);
    });
    if (missing.length) {
      const res = await fetch("./data/etf_prices.json");
      if (res.ok) {
        const bundle = await res.json();
        missing.forEach((code) => {
          const rows = bundle.prices && bundle.prices[code];
          if (rows) state.prices[code] = Object.fromEntries(rows.map((r) => [r.d, r.c]));
        });
      }
    }
  } finally {
    state.loadingPrices = false;
  }
}

function periodBounds() {
  const ends = state.meta.etfs.map((e) => e.end).filter(Boolean).sort();
  const end = ends.at(-1);
  const customStart = $("#startDate").value,
    customEnd = $("#endDate").value;
  if (customStart && customEnd) return [customStart, customEnd];
  const years = { "1y": 1, "3y": 3, "5y": 5, max: 20 }[state.period] || 5;
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
 * Taxable: annual distribution yield tax drag 15.4% + exit tax 15.4% on remaining gain.
 * Pension: no annual tax; exit tax at selected pension rate on gain.
 */
function simulateTax(result, picks) {
  const invested = result.totalInvested;
  const final = result.finalValue;
  const years = Math.max(result.years || 0, 0);
  const tw = result.weights || {};
  let yld = 0;
  for (const [c, w] of Object.entries(tw)) yld += w * annualYieldFor(c);

  const avgCapital = (invested + final) / 2;
  const annualYieldTax = avgCapital * yld * 0.154 * years;
  const afterAnnual = Math.max(0, final - annualYieldTax);
  const taxableGain = Math.max(0, afterAnnual - invested);
  const taxableFinal = afterAnnual - taxableGain * 0.154;

  const pensionRate = state.pensionTaxRate;
  const pensionGain = Math.max(0, final - invested);
  const pensionFinal = final - pensionGain * pensionRate;

  const activeFinal = state.accountType === "pension" ? pensionFinal : taxableFinal;
  const bonus = pensionFinal - taxableFinal;

  return {
    yld,
    annualYieldTax,
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
      : `일반 계좌 · 연분배 드래그+출구 15.4%`;
  return `<div class="card pad"><div class="section-title">절세 비교 (단순 모형)</div>
    <div class="tax-grid">
      <div><div class="label">세전 기말</div><div class="val">${won(tax.preTaxFinal)}</div></div>
      <div><div class="label">일반 계좌 모형</div><div class="val">${won(tax.taxableFinal)}</div></div>
      <div><div class="label">연금 계좌 모형</div><div class="val">${won(tax.pensionFinal)}</div></div>
      <div><div class="label">절세 보너스</div><div class="val ${tax.bonus >= 0 ? "pos" : "neg"}">${won(tax.bonus)}</div></div>
    </div>
    <div class="warn">선택: ${mode} · 포트 모델 분배율 ~${(tax.yld * 100).toFixed(1)}%/년 · 수수료·중도인출·한도 미반영 · 세무 자문 아님</div>
  </div>`;
}

async function run() {
  const picks = Object.entries(state.selected).filter(([, w]) => w > 0);
  if (!picks.length) return;
  const codes = picks.map(([c]) => c);
  await ensurePrices(codes);
  for (const c of codes) {
    if (!state.prices[c]) {
      $("#result").innerHTML = `<div class="card pad empty">${c} 시세가 없습니다. fast_ingest 를 다시 실행하세요.</div>`;
      return;
    }
  }
  const [start, end] = periodBounds();
  const initial = state.dcaOn ? state.initialCapital : 1;
  const monthly = state.dcaOn ? state.monthlyAmount : 0;
  const priceMap = state.totalReturn
    ? buildTotalReturnPrices(state.prices, [...codes, BENCH])
    : state.prices;
  const result = backtest(
    Object.fromEntries(picks),
    priceMap,
    start,
    end,
    state.rebalance,
    initial,
    monthly
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
    };
  }
  renderResult(result, bench, picks, corr, taxView);
}

/**
 * Same-day: mark-to-market THEN rebalance.
 * DCA: on first trading day of each new month, add cash then buy to target weights.
 * Numbers are computed only here (and in agents/build_backtest.py).
 */
function backtest(weights, priceMap, start, end, rebalance, initialCapital = 1, monthlyContribution = 0) {
  const codes = Object.keys(weights);
  const total = codes.reduce((s, c) => s + weights[c], 0);
  const tw = Object.fromEntries(codes.map((c) => [c, weights[c] / total]));
  const sets = codes.map(
    (c) => new Set(Object.keys(priceMap[c]).filter((d) => d >= start && d <= end))
  );
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  if (common.length < 20)
    return { error: "선택한 ETF의 공통 상장 기간이 너무 짧습니다. 기간을 줄이거나 종목을 바꿔보세요." };

  const q = (m) => Math.floor((Number(m) - 1) / 3);
  const isRebal = (prev, cur) => {
    if (rebalance === "N") return false;
    if (!prev) return true;
    const [py, pm] = prev.split("-"),
      [cy, cm] = cur.split("-");
    if (rebalance === "Y") return py !== cy;
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
  const curve = [],
    rets = [];

  for (const d of common) {
    const px = Object.fromEntries(codes.map((c) => [c, priceMap[c][d]]));
    if (!units) {
      units = Object.fromEntries(codes.map((c) => [c, (tw[c] * value) / px[c]]));
      value = codes.reduce((s, c) => s + units[c] * px[c], 0);
    } else {
      // 1) Mark to market
      value = codes.reduce((s, c) => s + units[c] * px[c], 0);
      if (prevValue != null && prevValue > 0) rets.push(value / prevValue - 1);

      // 2) DCA cash then 3) rebalance
      let doRebal = isRebal(prev, d);
      if (monthlyContribution > 0 && isNewMonth(prev, d)) {
        value += monthlyContribution;
        totalInvested += monthlyContribution;
        contributions += 1;
        doRebal = true;
      }
      if (doRebal) {
        units = Object.fromEntries(codes.map((c) => [c, (tw[c] * value) / px[c]]));
        value = codes.reduce((s, c) => s + units[c] * px[c], 0);
      }
    }
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
    curve.push({ d, v: value / initialCapital });
    prev = d;
    prevValue = value;
  }

  const yearly = {},
    byY = {};
  curve.forEach(({ d, v }) => {
    (byY[d.slice(0, 4)] ||= []).push(v);
  });
  Object.entries(byY).forEach(([y, vs]) => (yearly[y] = vs[vs.length - 1] / vs[0] - 1));

  const days = curve.length - 1,
    years = days / 252;
  const finalValue = prevValue;
  const totalRet = finalValue / totalInvested - 1;
  const cagr = years > 0 ? Math.pow(finalValue / totalInvested, 1 / years) - 1 : 0;
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance =
    rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length > 1 ? rets.length - 1 : 1);
  const std = Math.sqrt(variance),
    vol = std * Math.sqrt(252),
    rf = 0.03 / 252;
  const ex = rets.map((r) => r - rf);
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
    weights: tw,
    codes,
    totalInvested,
    finalValue,
    contributions,
    initialCapital,
    monthlyContribution,
  };
}

function renderResult(r, bench, picks, corr, tax) {
  const host = $("#result");
  if (r.error) {
    host.innerHTML = `<div class="card pad empty">${r.error}</div>`;
    return;
  }
  const dcaNote =
    r.monthlyContribution > 0
      ? `<div class="warn">월 적립 · 납입 합 ${won(r.totalInvested)} → 기말 ${won(r.finalValue)} · ${r.contributions}회 납입 · 수익률은 납입 원금 합 대비</div>`
      : "";
  const trNote = state.totalReturn
    ? `<div class="warn">Total Return 모드 · 분배율 모델값으로 일별 합성 가격 사용 · 실제 분배금과 다를 수 있음</div>`
    : "";
  const retLabel = state.totalReturn ? "가격+분배(모형)" : "가격수익률(분배금 미포함)";
  host.innerHTML = `<div class="kpis">${kpi("연환산 수익률", pct(r.cagr), cls(r.cagr))}${kpi("누적 수익률", pct(r.totalRet), cls(r.totalRet))}${kpi("최대낙폭", pct(r.mdd), "neg")}${kpi("변동성", pct(r.vol, 1), "")}${kpi("샤프", r.sharpe.toFixed(2), cls(r.sharpe))}</div><div class="card chart-wrap"><canvas id="curve"></canvas></div>${dcaNote}${trNote}${renderCorrCard(corr)}${renderTaxCard(tax)}<div class="bottom"><div class="card pad"><div class="section-title">연도별 수익률 · 벤치마크 KODEX 200</div><table><thead><tr><th>연도</th><th>포트폴리오</th><th>KODEX 200</th></tr></thead><tbody>${Object.keys({ ...r.yearly, ...(bench.yearly || {}) })
    .sort()
    .map((y) => {
      const a = r.yearly[y],
        b = bench.yearly && bench.yearly[y];
      return `<tr><td>${y}</td><td class="${cls(a)}">${pct(a)}</td><td class="${cls(b)}">${pct(b)}</td></tr>`;
    })
    .join("")}</tbody></table><div class="warn">공통 기간 ${r.start} ~ ${r.end} · ${r.days}거래일 · ${retLabel}</div></div><div class="card pad"><div class="section-title">리뷰 에이전트</div><div class="agent" id="agentText"></div></div></div>`;
  drawChart(r, bench);
  $("#agentText").textContent = reviewAgent(r, bench, picks);
}

function kpi(label, val, klass) {
  return `<div class="card kpi"><div class="label">${label}</div><div class="val ${klass}">${val}</div></div>`;
}

function drawChart(r, bench) {
  const bmap = Object.fromEntries((bench.curve || []).map((p) => [p.d, p.v]));
  const labels = r.curve.map((p) => p.d);
  const port = r.curve.map((p) => +(p.v * 100).toFixed(2));
  const ben = r.curve.map((p) => +(((bmap[p.d] || 1) * 100).toFixed(2)));
  const ctx = document.getElementById("curve");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: r.monthlyContribution > 0 ? "포트폴리오(자산/원금)" : "포트폴리오",
          data: port,
          borderColor: "#7dd3c0",
          backgroundColor: "rgba(125,211,192,.12)",
          fill: true,
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        },
        {
          label: "KODEX 200",
          data: ben,
          borderColor: "#8b9aab",
          tension: 0.15,
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
      plugins: { legend: { labels: { color: "#8b9aab" } } },
      scales: {
        x: { ticks: { color: "#667687", maxTicksLimit: 8 }, grid: { color: "rgba(39,49,64,.45)" } },
        y: { ticks: { color: "#667687" }, grid: { color: "rgba(39,49,64,.45)" } },
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
  if (state.totalReturn) lines.push("· Total Return(분배 모형) 적용 중입니다.");
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
    "· 기본은 가격 수익률입니다. TR 토글 시에도 분배율은 모델값입니다.",
    "· 세금·수수료 모형은 단순화되어 있습니다.",
    "· 과거 숫자로 미래 비중을 정하면 안 됩니다.",
    "· 월 적립 연환산은 납입 원금 합 대비 단순 계산입니다."
  );
  return lines.join("\n");
}

document.addEventListener("DOMContentLoaded", () => {
  $("#period").onchange = (e) => {
    state.period = e.target.value;
    $("#customDates").style.display = e.target.value === "custom" ? "flex" : "none";
  };
  $("#rebalance").onchange = (e) => (state.rebalance = e.target.value);
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
  $("#trOn").onchange = (e) => {
    state.totalReturn = e.target.checked;
  };
  const syncAcct = () => {
    state.accountType = $("#acctPension").checked ? "pension" : "taxable";
    $("#pensionTaxRow").style.display = state.accountType === "pension" ? "flex" : "none";
  };
  $("#acctTaxable").onchange = syncAcct;
  $("#acctPension").onchange = syncAcct;
  $("#pensionTaxRate").onchange = (e) => {
    state.pensionTaxRate = Number(e.target.value) || 0.044;
  };
  $("#run").onclick = () => run();
  boot().catch((err) => {
    $("#result").innerHTML = `<div class="card pad empty">${err.message || err}</div>`;
  });
});
