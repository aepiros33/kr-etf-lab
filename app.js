const PRESETS = {
  stable: { label: "안정", w: { "069500": 25, "360750": 20, "148070": 30, "411060": 10, "357870": 15 } },
  balanced: { label: "균형", w: { "069500": 20, "133690": 20, "360750": 15, "148070": 20, "411060": 10, "357870": 15 } },
  growth: { label: "성장", w: { "133690": 30, "396500": 20, "360750": 20, "229200": 15, "411060": 15 } },
  korea: { label: "한국핵심", w: { "069500": 45, "229200": 20, "091160": 20, "411060": 15 } },
};
const state = { data: null, selected: {}, period: "5y", rebalance: "Q", chart: null };
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
async function boot() {
  const res = await fetch("./data/etf_prices.json");
  state.data = await res.json();
  $("#stamp").textContent = `시세 갱신 ${state.data.generatedAt}\n${state.data.source}`;
  renderPresets(); renderList(); applyPreset("balanced");
}
function renderPresets() {
  const box = $("#presets"); box.innerHTML = "";
  Object.entries(PRESETS).forEach(([k, p]) => {
    const b = document.createElement("button");
    b.className = "chip"; b.dataset.key = k; b.textContent = p.label;
    b.onclick = () => applyPreset(k); box.appendChild(b);
  });
}
function applyPreset(key) {
  document.querySelectorAll("#presets .chip").forEach((el) => el.classList.toggle("active", el.dataset.key === key));
  state.selected = {};
  Object.entries(PRESETS[key].w).forEach(([code, val]) => { if (state.data.prices[code]) state.selected[code] = val; });
  renderList();
}
function renderList() {
  const box = $("#etfList"); box.innerHTML = "";
  const cats = ["국내주식", "해외주식", "테마", "채권", "원자재", "현금성"];
  const ordered = [...state.data.etfs].sort((a, b) => cats.indexOf(a.category) - cats.indexOf(b.category) || a.name.localeCompare(b.name, "ko"));
  ordered.forEach((etf) => {
    const on = etf.code in state.selected;
    const el = document.createElement("div");
    el.className = "etf" + (on ? " on" : "");
    el.innerHTML = `<div class="etf-head"><input type="checkbox" ${on ? "checked" : ""} data-code="${etf.code}" /><div><div class="etf-name">${etf.name}</div><div class="etf-code">${etf.code} · ${etf.issuer} · ${etf.start}~</div></div><span class="cat">${etf.category}</span></div><div class="weight-row" style="${on ? "" : "display:none"}"><input type="range" min="0" max="100" value="${state.selected[etf.code] || 0}" data-range="${etf.code}" /><div class="wnum">${state.selected[etf.code] || 0}%</div></div>`;
    el.querySelector("input[type=checkbox]").onchange = (e) => {
      if (e.target.checked) state.selected[etf.code] = 10; else delete state.selected[etf.code];
      renderList();
    };
    const range = el.querySelector("input[type=range]");
    if (range) range.oninput = (e) => { state.selected[etf.code] = Number(e.target.value); el.querySelector(".wnum").textContent = e.target.value + "%"; updateSum(); };
    box.appendChild(el);
  });
  updateSum();
}
function updateSum() {
  const sum = Object.values(state.selected).reduce((a, b) => a + b, 0);
  $("#sum").textContent = `비중 합 ${sum}%`;
  $("#sum").style.color = sum === 100 ? "var(--accent)" : "var(--accent2)";
}
function periodBounds() {
  const end = state.data.etfs.map((e) => e.end).sort().at(-1);
  const customStart = $("#startDate").value, customEnd = $("#endDate").value;
  if (customStart && customEnd) return [customStart, customEnd];
  const years = { "1y": 1, "3y": 3, "5y": 5, max: 20 }[state.period] || 5;
  const startDt = new Date(end + "T00:00:00"); startDt.setFullYear(startDt.getFullYear() - years);
  return [startDt.toISOString().slice(0, 10), end];
}
function run() {
  const picks = Object.entries(state.selected).filter(([, w]) => w > 0);
  if (!picks.length) return;
  const [start, end] = periodBounds();
  const result = backtest(Object.fromEntries(picks), state.data.prices, start, end, state.rebalance);
  const bench = backtest({ "069500": 100 }, state.data.prices, result.start, result.end, "Q");
  renderResult(result, bench, picks);
}
function backtest(weights, priceMap, start, end, rebalance) {
  const codes = Object.keys(weights);
  const total = codes.reduce((s, c) => s + weights[c], 0);
  const tw = Object.fromEntries(codes.map((c) => [c, weights[c] / total]));
  const sets = codes.map((c) => new Set(priceMap[c].filter((r) => r.d >= start && r.d <= end).map((r) => r.d)));
  let common = [...sets[0]];
  for (const s of sets.slice(1)) common = common.filter((d) => s.has(d));
  common.sort();
  if (common.length < 20) return { error: "선택한 ETF의 공통 상장 기간이 너무 짧습니다. 기간을 줄이거나 종목을 바꿔보세요." };
  const px = {}; codes.forEach((c) => { px[c] = Object.fromEntries(priceMap[c].map((r) => [r.d, r.c])); });
  const q = (m) => Math.floor((Number(m) - 1) / 3);
  const isRebal = (prev, cur) => {
    if (rebalance === "N") return false;
    if (!prev) return true;
    const [py, pm] = prev.split("-"), [cy, cm] = cur.split("-");
    if (rebalance === "Y") return py !== cy;
    return py !== cy || q(pm) !== q(cm);
  };
  let units = null, value = 1, peak = 1, mdd = 0, prev = null;
  const curve = [], rets = [];
  for (const d of common) {
    if (!units) units = Object.fromEntries(codes.map((c) => [c, (tw[c] * value) / px[c][d]]));
    else {
      value = codes.reduce((s, c) => s + units[c] * px[c][d], 0);
      if (isRebal(prev, d)) units = Object.fromEntries(codes.map((c) => [c, (tw[c] * value) / px[c][d]]));
    }
    value = codes.reduce((s, c) => s + units[c] * px[c][d], 0);
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
    if (curve.length) rets.push(value / curve[curve.length - 1].v - 1);
    curve.push({ d, v: value }); prev = d;
  }
  const yearly = {}, byY = {};
  curve.forEach(({ d, v }) => { (byY[d.slice(0, 4)] ||= []).push(v); });
  Object.entries(byY).forEach(([y, vs]) => (yearly[y] = vs[vs.length - 1] / vs[0] - 1));
  const days = curve.length - 1, years = days / 252;
  const totalRet = curve.at(-1).v / curve[0].v - 1;
  const cagr = years > 0 ? Math.pow(curve.at(-1).v / curve[0].v, 1 / years) - 1 : 0;
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length > 1 ? rets.length - 1 : 1);
  const std = Math.sqrt(variance), vol = std * Math.sqrt(252), rf = 0.03 / 252;
  const ex = rets.map((r) => r - rf);
  const meanEx = ex.reduce((a, b) => a + b, 0) / (ex.length || 1);
  const sharpe = std ? (meanEx / std) * Math.sqrt(252) : 0;
  const yvals = Object.values(yearly);
  return { start: curve[0].d, end: curve.at(-1).d, days, years, totalRet, cagr, mdd, vol, sharpe, yearly, curve, bestYear: yvals.length ? Math.max(...yvals) : null, worstYear: yvals.length ? Math.min(...yvals) : null, weights: tw, codes };
}
function renderResult(r, bench, picks) {
  const host = $("#result");
  if (r.error) { host.innerHTML = `<div class="card pad empty">${r.error}</div>`; return; }
  host.innerHTML = `<div class="kpis">${kpi("연환산 수익률", pct(r.cagr), cls(r.cagr))}${kpi("누적 수익률", pct(r.totalRet), cls(r.totalRet))}${kpi("최대낙폭", pct(r.mdd), "neg")}${kpi("변동성", pct(r.vol, 1), "")}${kpi("샶", r.sharpe.toFixed(2), cls(r.sharpe))}</div><div class="card chart-wrap"><canvas id="curve"></canvas></div><div class="bottom"><div class="card pad"><div class="section-title">연도별 수익률 · 벤치마크 KODEX 200</div><table><thead><tr><th>연도</th><th>포트폴리오</th><th>KODEX 200</th></tr></thead><tbody>${Object.keys({ ...r.yearly, ...bench.yearly }).sort().map((y) => { const a = r.yearly[y], b = bench.yearly[y]; return `<tr><td>${y}</td><td class="${cls(a)}">${pct(a)}</td><td class="${cls(b)}">${pct(b)}</td></tr>`; }).join("")}</tbody></table><div class="warn">공통 기간 ${r.start} ~ ${r.end} · ${r.days}거래일 · 가격수익률(분배금 미포함)</div></div><div class="card pad"><div class="section-title">리뷰 에이전트</div><div class="agent" id="agentText"></div></div></div>`;
  drawChart(r, bench);
  $("#agentText").textContent = reviewAgent(r, bench, picks);
}
function kpi(label, val, klass) { return `<div class="card kpi"><div class="label">${label}</div><div class="val ${klass}">${val}</div></div>`; }
function drawChart(r, bench) {
  const bmap = Object.fromEntries(bench.curve.map((p) => [p.d, p.v]));
  const labels = r.curve.map((p) => p.d);
  const port = r.curve.map((p) => +(p.v * 100).toFixed(2));
  const ben = r.curve.map((p) => +(((bmap[p.d] || 1) * 100).toFixed(2)));
  const ctx = document.getElementById("curve");
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [
      { label: "포트폴리오", data: port, borderColor: "#7dd3c0", backgroundColor: "rgba(125,211,192,.12)", fill: true, tension: 0.15, pointRadius: 0, borderWidth: 2 },
      { label: "KODEX 200", data: ben, borderColor: "#8b9aab", tension: 0.15, pointRadius: 0, borderWidth: 1.4, borderDash: [4, 4] },
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#8b9aab" } } },
      scales: { x: { ticks: { color: "#667687", maxTicksLimit: 8 }, grid: { color: "rgba(39,49,64,.45)" } }, y: { ticks: { color: "#667687" }, grid: { color: "rgba(39,49,64,.45)" } } } },
  });
}
function reviewAgent(r, bench, picks) {
  const names = Object.fromEntries(state.data.etfs.map((e) => [e.code, e.name]));
  const lines = [];
  lines.push(`검수 메모 · 공통 기간 ${r.start} ~ ${r.end} (${r.years.toFixed(1)}년)`, "");
  const vs = r.cagr - bench.cagr;
  if (vs > 0.01) lines.push(`· 같은 기간 KODEX 200보다 연환산 ${pct(vs)} 앞섬습니다.`);
  else if (vs < -0.01) lines.push(`· KODEX 200보다 연환산 ${pct(vs)} 뒤처졌습니다.`);
  else lines.push("· 벤치마크와 거의 비슷한 속도입니다.");
  if (r.mdd < -0.35) lines.push("· 최대낙폭이 35%를 넘습니다.");
  else if (r.mdd < -0.2) lines.push("· 낙폭 20%대. 주식형 비중이 느껴지는 수준입니다.");
  else lines.push("· 낙폭은 비교적 관리된 편입니다.");
  if (picks.length < 3) lines.push("· 종목이 적습니다.");
  lines.push("", "한계", "· 가격 수익률입니다. 분배금·세금·수수료는 빨져 있습니다.", "· 과거 숫자로 미래 비중을 정하면 안 됩니다.");
  return lines.join("\n");
}
document.addEventListener("DOMContentLoaded", () => {
  $("#period").onchange = (e) => { state.period = e.target.value; $("#customDates").style.display = e.target.value === "custom" ? "flex" : "none"; };
  $("#rebalance").onchange = (e) => (state.rebalance = e.target.value);
  $("#run").onclick = run;
  boot().then(() => run());
});
