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

function ensureStoryPanel() {
  if ($("#storyPanel")) return true;
  const anchor = $("#presetProxyNote");
  if (!anchor || !anchor.parentNode) return false;
  const wrap = document.createElement("div");
  wrap.id = "storyPanel";
  wrap.innerHTML = `
    <div class="section-title">1,000만 원 성적표</div>
    <p class="muted-note">블로그용 비교 숫자입니다. 리밸런싱 없음 · 일시금 · 수정주가 기준(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬. 기존 프리셋 비중은 바꾸지 않습니다.</p>
    <div class="presets" id="storyChecks"></div>
    <div class="row dca-row" style="margin-top:8px">
      <label class="field">시작 원금(원)
        <input type="number" id="storyCapital" min="10000" step="100000" value="10000000" />
      </label>
    </div>
    <label class="toggle">
      <input type="checkbox" id="storyCommon" checked />
      <span>공통 기간만 비교 (늦게 상장한 종목 기준으로 맞춤)</span>
    </label>
    <div class="btn-row">
      <button type="button" class="primary" id="btnStoryBoard">성적표 만들기</button>
      <button type="button" class="secondary" id="btnStoryCopy" disabled>문장 복사</button>
    </div>
    <p class="muted-note" id="storyStatus">구성을 고른 뒤 「성적표 만들기」를 누르세요.</p>
  `;
  anchor.insertAdjacentElement("afterend", wrap);
  renderStoryChecks();
  const runBtn = $("#btnStoryBoard");
  if (runBtn) {
    runBtn.addEventListener("click", () => {
      runStoryBoard().catch((err) => {
        setStoryStatus(err && err.message ? err.message : String(err));
      });
    });
  }
  const copyBtn = $("#btnStoryCopy");
  if (copyBtn) {
    copyBtn.addEventListener("click", copyStoryText);
  }
  return true;
}

function storyCopyText(payload) {
  const { rows, capital, windowStart, windowEnd, commonOn } = payload;
  const lines = [];
  lines.push(`[과거 시뮬] ${windowStart} ~ ${windowEnd}`);
  lines.push(`${won(capital)}을 한 번에 넣었다면 (리밸런싱 없음 · 수정주가 기준 · 세금 미반영)`);
  if (commonOn) lines.push("비교 구간은 선택한 구성이 모두 존재하는 공통 기간입니다.");
  lines.push("");
  rows.forEach((r, i) => {
    const retPct = pct(r.totalRet, 1);
    const mult = r.multiple.toFixed(2);
    lines.push(
      `${i + 1}. ${r.label}  ${won(r.startWon)} → ${won(r.endWon)}  (${mult}배 · 누적 ${retPct} · 연환산 ${pct(r.cagr, 1)} · MDD ${pct(r.mdd, 1)})`
    );
  });
  lines.push("");
  lines.push("숫자는 KR ETF Lab 백테스트 엔진 결과입니다. 과거 수익률은 미래 수익을 보장하지 않으며 투자 자문이 아닙니다.");
  return lines.join("\n");
}

function copyStoryText() {
  const text = window.__storyCopyText || "";
  if (!text) {
    setStoryStatus("먼저 성적표를 만드세요.");
    return;
  }
  const done = () => setStoryStatus("블로그용 문장을 복사했습니다.");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    setStoryStatus("복사에 실패했습니다. 아래 문장을 직접 선택하세요.");
  }
  ta.remove();
}

function renderStoryBoard(payload) {
  const host = $("#result");
  if (!host) {
    setStoryStatus("결과 영역을 찾지 못했습니다.");
    return;
  }
  const { rows, capital, windowStart, windowEnd, commonOn } = payload;
  window.__storyCopyText = storyCopyText(payload);
  const copyBtn = $("#btnStoryCopy");
  if (copyBtn) copyBtn.disabled = false;

  const maxWon = Math.max(...rows.map((r) => r.endWon), 1);
  const cards = rows
    .map((r, i) => {
      const width = Math.max(4, Math.round((r.endWon / maxWon) * 100));
      return `
        <div class="card pad" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap">
            <strong>${i + 1}. ${r.label}</strong>
            <span class="${cls(r.totalRet)}">${pct(r.totalRet, 1)} · ${r.multiple.toFixed(2)}배</span>
          </div>
          <p class="muted-note" style="margin:6px 0 8px">${r.blurb || ""} · ${r.start} ~ ${r.end} (${Number(r.years || 0).toFixed(1)}년)</p>
          <div style="height:8px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden">
            <div style="width:${width}%;height:100%;background:#7dd3fc"></div>
          </div>
          <div class="row" style="margin-top:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
            <div>시작 ${won(r.startWon)}</div>
            <div>기말 <strong>${won(r.endWon)}</strong></div>
            <div>연환산 ${pct(r.cagr, 1)}</div>
            <div>MDD ${pct(r.mdd, 1)}</div>
          </div>
        </div>`;
    })
    .join("");

  host.innerHTML = `
    <div class="card pad">
      <div class="section-title">1,000만 원 성적표</div>
      <p class="muted-note">${windowStart} ~ ${windowEnd} · 일시금 ${won(capital)} · ${commonOn ? "공통 기간" : "각 구성 최장"} · 리밸런싱 없음 · 수정주가 기준(분배금 세전 재투자 효과 포함) · 세금 미반영 · 과거 시뮬</p>
    </div>
    ${cards}
    <div class="card pad">
      <div class="section-title">블로그용 문장</div>
      <pre id="storyCopyBox" style="white-space:pre-wrap;font-size:13px;line-height:1.55;margin:0">${escapeHtml(window.__storyCopyText)}</pre>
    </div>
    <p class="muted-note">투자 자문이 아닙니다. 특정 상품을 사라는 뜻이 아닙니다.</p>
  `;
  if (typeof state !== "undefined") state.viewMode = "story";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">");
}

async function runStoryBoard() {
  if (typeof currentStrategyCfg !== "function" || typeof executePortBacktest !== "function") {
    setStoryStatus("앱 엔진이 아직 로드되지 않았습니다. 새로고침 후 다시 시도하세요.");
    return;
  }
  if (!state || !state.meta) {
    setStoryStatus("메타 데이터를 불러오는 중입니다. 잠시 후 다시 누르세요.");
    return;
  }
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
  if (!windowStart || !windowEnd || windowStart >= windowEnd) {
    setStoryStatus("공통 기간이 없습니다. 구성을 줄이거나 공통 기간 체크를 끄세요.");
    return;
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

function bootStoryBoard() {
  if (ensureStoryPanel()) return;
  let n = 0;
  const t = setInterval(() => {
    n += 1;
    if (ensureStoryPanel() || n > 40) clearInterval(t);
  }, 250);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootStoryBoard);
} else {
  bootStoryBoard();
}
