/** 1,000만 원 성적표 — KRX listed buy-and-hold compare for blog copy.
 * Uses the existing backtest engine only. Do not compute returns here.
 * Keep out of PRESETS so chip weights stay unchanged.
 */
const STORY_PRESETS = {
  korea200: {
    label: "🇰🇷 KODEX 200",
    blurb: "코스피200 대표",
    w: { "069500": 100 },
    defaultOn: true,
  },
  usNasdaq: {
    label: "🇺🇸 TIGER 나스닥100",
    blurb: "국내상장 미국 성장·기술",
    w: { "133690": 100 },
    defaultOn: true,
  },
  goldFxH: {
    label: "🥇 KODEX 골드선물(H)",
    blurb: "금 선물 · 환헤지",
    w: { "132030": 100 },
    defaultOn: true,
  },
  cashBond: {
    label: "💵 KODEX 단기채권",
    blurb: "현금성",
    w: { "153130": 100 },
    defaultOn: true,
  },
  koreaUsMix: {
    label: "🇰🇷🇺🇸 한미 분산",
    blurb: "코스피200 35 · 나스닥100 30 · 국고채10년 20 · 단기채 15",
    w: { "069500": 35, "133690": 30, "148070": 20, "153130": 15 },
    defaultOn: false,
  },
};

function setStoryStatus(msg) {
  const el = $("#storyStatus");
  if (el) el.textContent = msg || "";
}

function selectedStoryKeys() {
  return [...document.querySelectorAll("#storyChecks .chip.active")]
    .map((b) => b.dataset.key)
    .filter((k) => k && STORY_PRESETS[k]);
}

function renderStoryChecks() {
  const box = $("#storyChecks");
  if (!box) return;
  box.innerHTML = "";
  Object.entries(STORY_PRESETS).forEach(([k, p]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (p.defaultOn ? " active" : "");
    b.dataset.key = k;
    b.title = p.blurb || "";
    b.textContent = p.label;
    b.onclick = () => b.classList.toggle("active");
    box.appendChild(b);
  });
}

function storyBuyHoldCfg() {
  const cfg = currentStrategyCfg();
  cfg.rebalance = "N";
  cfg.dcaOn = false;
  cfg.maOverlay = false;
  cfg.regimeHedge = false;
  cfg.goldOn = false;
  cfg.bandOn = false;
  cfg.volTarget = false;
  cfg.sleeveTrend = false;
  cfg.weighting = "fixed";
  cfg.monthlyAmount = 0;
  return cfg;
}

async function runStoryBoard() {
  const keys = selectedStoryKeys();
  if (keys.length < 2) {
    setStoryStatus("성적표는 구성을 2개 이상 고르세요.");
    return;
  }
  const capitalEl = $("#storyCapital");
  const capital = Math.max(10000, Number(capitalEl && capitalEl.value) || 10_000_000);
  const commonOn = $("#storyCommon") ? $("#storyCommon").checked : true;
  setStoryStatus("성적표 계산 중…");
  const packs = keys.map((k) => ({ key: k, ...STORY_PRESETS[k] }));
  const codes = [...new Set(packs.flatMap((p) => Object.keys(p.w)))];
  await ensurePrices([...codes, BENCH]);
  const [reqStart, reqEnd] = periodBounds();
  const cfg = storyBuyHoldCfg();
  const firstPass = [];
  for (const p of packs) {
    const picks = Object.entries(p.w).filter(([, w]) => w > 0);
    const r = await executePortBacktest(picks, reqStart, reqEnd, cfg);
    if (r.error) {
      setStoryStatus(`${p.label}: ${r.error}`);
      return;
    }
    firstPass.push({ pack: p, picks, result: r });
  }
  let windowStart = firstPass[0].result.start;
  let windowEnd = firstPass[0].result.end;
  if (commonOn) {
    windowStart = firstPass.reduce((m, x) => (x.result.start > m ? x.result.start : m), windowStart);
    windowEnd = firstPass.reduce((m, x) => (x.result.end < m ? x.result.end : m), windowEnd);
  }
  const rows = [];
  for (const item of firstPass) {
    let r = item.result;
    if (commonOn && (r.start !== windowStart || r.end !== windowEnd)) {
      r = await executePortBacktest(item.picks, windowStart, windowEnd, cfg);
      if (r.error) {
        setStoryStatus(`${item.pack.label}: ${r.error}`);
        return;
      }
    }
    const multiple = 1 + Number(r.totalRet || 0);
    rows.push({
      key: item.pack.key,
      label: item.pack.label,
      blurb: item.pack.blurb || "",
      start: r.start,
      end: r.end,
      years: r.years,
      totalRet: r.totalRet,
      cagr: r.cagr,
      mdd: r.mdd,
      multiple,
      startWon: capital,
      endWon: capital * multiple,
    });
  }
  rows.sort((a, b) => b.endWon - a.endWon);
  if (typeof state !== "undefined") state.viewMode = "story";
  renderStoryBoard({ rows, capital, windowStart, windowEnd, commonOn });
  setStoryStatus(`성적표 ${windowStart} ~ ${windowEnd} · 일시금 ${won(capital)}`);
}
