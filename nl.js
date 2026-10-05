/* nl.js — 쉬운 입력: 문장 → 종목·비중·기간 (규칙 기반, 서버 없음).
 * 새 계산 엔진이 아니다. 해석 결과로 기존 state를 채우고 기존 run()을 부른다.
 * 숫자(CAGR/MDD 등)는 app.js backtest()가 계산한다(agents/build_backtest.py와 동일 로직).
 * 과거 시뮬만. 투자 자문 아님.
 */
(function (root) {
  "use strict";

  // ---- 사전 (유니버스 meta에 있는 코드만 쓴다. 없으면 로드 시 버린다) ----
  // fam 변형: cc = 커버드콜, h = 환헤지. 변형이 없는데 수식어가 붙으면 실행하지 않는다.
  const NL_FAMILIES = [
    { keys: ["나스닥", "나스닥100", "미국나스닥", "미국나스닥100", "nasdaq", "nasdaq100", "qqq"], code: "133690", cc: "486290", h: "449190" },
    { keys: ["s&p", "s&p500", "에스앤피", "에스앤피500", "미국s&p", "미국s&p500", "sp500", "snp", "snp500"], code: "360750", cc: "482730", h: "448290" },
    { keys: ["미국주식", "미국"], code: "360750", cc: "482730", h: "448290", alts: [["133690", "미국나스닥100"]], single: false },
    { keys: ["코스피", "코스피200", "kospi", "kospi200", "국내주식", "한국주식"], code: "069500", cc: "475720" },
    { keys: ["코스피100"], code: "237350" },
    { keys: ["코스닥", "코스닥150", "kosdaq"], code: "229200" },
    { keys: ["금", "골드", "금선물", "gold"], code: "132030", h: "132030" },
    { keys: ["금현물", "krx금현물"], code: "411060" },
    { keys: ["현금", "파킹", "단기채", "단기채권", "cash"], code: "153130" },
    { keys: ["단기자금"], code: "130730" },
    { keys: ["반도체", "국내반도체", "한국반도체", "k반도체"], code: "091160", cc: "0177R0", alts: [["390390", "미국반도체"]] },
    { keys: ["미국반도체"], code: "390390" },
    { keys: ["필라델피아반도체", "필라델피아", "필반", "sox"], code: "381180" },
    { keys: ["채권", "국채", "국고채"], code: "148070", alts: [["114260", "국고채3년"]] },
    { keys: ["국고채10년", "국채10년", "10년국채", "10년국고채"], code: "148070" },
    { keys: ["국고채3년", "국채3년", "3년국채", "3년국고채"], code: "114260" },
    { keys: ["초장기채", "국고채30년", "국채30년", "30년국채"], code: "385560" },
    { keys: ["미국장기채", "미국30년국채", "미국국채30년", "미국채30년", "미국채", "미국국채", "tlt"], code: "453850", cc: "476550", h: "453850",
      warn: "453850은 2023-03 상장이라 기간이 짧습니다" },
    { keys: ["종합채권"], code: "273130" },
    { keys: ["배당", "고배당", "배당주"], code: "161510", cc: "472150", alts: [["402970", "미국배당다우존스"]] },
    { keys: ["한국고배당", "국내고배당", "국내배당", "한국배당", "고배당주"], code: "161510" },
    { keys: ["미국배당", "미국배당주", "미국배당다우", "미국배당다우존스", "배당다우", "schd"], code: "402970", cc: "441640" },
    { keys: ["달러", "미국달러", "usd"], code: "329750", warn: "달러 = 329750 미국달러단기채권 ETF 가격입니다. 환율 그 자체가 아닙니다" },
    { keys: ["리츠", "reits", "reit"], code: "329200" },
    { keys: ["테크", "미국테크", "빅테크", "미국빅테크"], code: "381170", h: "314250" },
    { keys: ["일본", "니케이", "니케이225"], code: "241180" },
    { keys: ["중국", "항셍", "항셍테크", "차이나"], code: "371160" },
    { keys: ["인도", "니프티"], code: "453810" },
    { keys: ["선진국"], code: "251350" },
    { keys: ["2차전지", "이차전지"], code: "305720" },
    { keys: ["방산"], code: "449450" },
    { keys: ["조선"], code: "466920" },
    { keys: ["원자력", "원전"], code: "434730" },
    { keys: ["kofr"], code: "423160" },
    { keys: ["cd금리"], code: "357870" },
    { keys: ["은선물"], code: "144600" },
  ];

  // 프리셋 이름 → app.js PRESETS 키 (라벨 자체도 자동 등록)
  const NL_PRESET_KEYS = {
    "k-올웨더": "kAllWeather", "k올웨더": "kAllWeather", "케이올웨더": "kAllWeather", "올웨더": "kAllWeather",
    "영구포트폴리오": "permanent", "영구포트": "permanent", "영구": "permanent",
    "글로벌60/40": "global6040", "60/40": "global6040", "6040": "global6040", "글로벌6040": "global6040",
    "월배당인컴형": "monthlyIncome", "월배당인컴": "monthlyIncome",
    "골든버터플라이": "goldenButterfly", "버터플라이": "goldenButterfly",
    "성장80/20": "growth80", "80/20": "growth80",
    "한미분산": "koreaUs", "배당성장": "divGrowth", "반도체+방어": "semiDefensive", "반도체방어": "semiDefensive",
    "배당소득형": "divIncomeKR", "글로벌분산": "globalMulti", "한국성장": "koreaGrowth",
    "채권barbell": "bondBarbell", "채권바벨": "bondBarbell", "커버드콜소득": "coveredCallIncome",
    "리츠+인프라": "reitInfra", "리츠인프라": "reitInfra", "미국배당다우존스프리셋": "usDivDowKR",
    "만기매칭채+주식": "maturityBondMix", "만기매칭": "maturityBondMix",
  };

  // 「배당 위주 3종목」: 같은 테마에서 상장 이력이 긴 순서(지수 중복 없음)
  const NL_BASKETS = {
    배당: ["161510", "315960", "402970", "441800", "466940"],
    반도체: ["091160", "390390", "381180", "396500", "395270"],
    채권: ["148070", "114260", "273130", "385560"],
  };

  const NL_MODS = [
    ["레버리지", "lev"], ["인버스", "lev"], ["곱버스", "lev"], ["2x", "lev"], ["3x", "lev"], ["2배", "lev"], ["3배", "lev"],
    ["커버드콜", "cc"], ["커버드", "cc"],
    ["환헤지", "h"], ["환헷지", "h"], ["(h)", "h"], ["헤지", "h"],
    ["환노출", "unh"], ["언헤지", "unh"],
  ];

  const NL_STOP = new Set(
    ("위주 중심 비중 포트 포트폴리오 백테스트 백테 계산 계산해 계산해줘 해줘 해 줘 보여줘 돌려줘 돌려 시뮬 시뮬레이션 " +
      "으로 로 하고 그리고 및 랑 이랑 와 과 에 각각 씩 정도 기간 동안 최근 수익률 결과 투자 하면 했으면 했다면 " +
      "넣고 넣으면 섞어서 섞어 동일비중 동일 균등 똑같이 같은비중 리밸런싱 리밸 적립 기준 수익 보기 봐줘 알려줘 " +
      "etf 종목 개 종 년 퍼센트 프로 만원 원 해서 나눠서 나눠 반씩 비례 비례맞춤")
      .split(/\s+/)
  );
  const NL_PARTICLES = ["이랑", "하고", "으로", "에서", "까지", "부터", "랑", "과", "와", "을", "를", "은", "는", "이", "가", "에", "로", "도", "만", "씩", "의"];

  // 과거 시뮬 외 질문(무엇을 살지 등)은 계산하지 않는다. 화면에 이 단어들을 쓰지 않는다.
  const NL_REFUSE_RE = /추천|뭐\s*(사|살)|뭘\s*(사|살)|무엇을\s*(사|살)|어떤\s*(걸|것|거)\s*(사|살)|좋은\s*포트|사야\s*(해|돼|될|할)|살까|오를까|오를\s*거|유망|전망|예측|대박|수익\s*날/;
  const NL_REFUSE_MSG = "과거 시뮬만 합니다. 종목과 비중을 적어 주세요";
  const NL_REFUSE_RANK_MSG = "과거 격자 순위만 보여 줍니다. 기간·제외 종목을 적어 주세요";

  const NL_EXAMPLES = ["나스닥 60 코스피 20 금 20 10년", "K-올웨더 최대한 길게", "반도체 50 미국S&P 50 5년", "배당 위주 3종목 최장", "반도체 빼고 5년 수익률 높은 조합"];

  // ---- 격자 순위 검색 (nl3): 미리 계산된 data/rank_deep_nl3.json을 거르기만 한다. 새 격자 계산 없음 ----
  // 순위 의도. 화면에는 이 단어들을 다시 쓰지 않는다(입력 인식용).
  const NL_RANK_RE = /가장\s*높(은|았던)\s*(수익률?|수익|cagr|조합)?|최고\s*(의\s*)?(수익률?|수익|cagr)?|수익률?\s*(이|가)?\s*(가장\s*)?(높은|높았던|좋은|좋았던|상위|순위|순서|순|랭킹|top)|cagr\s*(높은|상위|순)|상위\s*\d*\s*(개|위|조합)?|top\s*\d*|랭킹|순위|높았던\s*조합|높은\s*조합/gi;
  const NL_RANK_SHALLOW_RE = /낙폭\s*(이|가)?\s*(가장\s*)?(적은|작은|낮은|얕은|덜한)|mdd\s*(적은|작은|낮은)/gi;
  const NL_RANK_PERIODS = { 1: "1y", 3: "3y", 5: "5y", 10: "10y" };
  const NL_RANK_CAPS = { 25: "m25", 30: "m30", 40: "m40" };
  // 제외 그룹: 명시 코드 + 이름 규칙(레버리지·인버스 이름은 제외 목록 표시에서 뺀다 — 풀에 없음). meta에 있는 코드만.
  const NL_GROUPS = [
    { keys: ["반도체", "반도체주", "칩", "hbm", "ai반도체"], label: "반도체",
      codes: ["091160", "091230", "396500", "395270", "390390", "381180", "442580", "446770", "469150", "455850", "471990", "0167A0", "0210A0", "497570"],
      re: /반도체|HBM|필라델피아/i },
    { keys: ["나스닥", "나스닥100", "미국나스닥"], label: "나스닥", codes: ["133690", "379810", "367380", "368590", "449190", "426030"], re: /나스닥/ },
    { keys: ["미국", "미국주식", "미국etf"], label: "미국", codes: ["133690", "360750", "381170"], re: /미국|S&P|나스닥/ },
    { keys: ["s&p", "s&p500", "에스앤피", "sp500"], label: "S&P500", codes: ["360750"], re: /S&P/i },
    { keys: ["금", "골드", "금현물", "금선물"], label: "금", codes: ["132030", "411060", "319640", "139320", "0072R0"], re: /골드|금현물|금선물|금은선물|KRX금/ },
    { keys: ["채권", "국채", "국고채", "채권형"], label: "채권", codes: [], re: /채권|국채|국고채|회사채|금융채|통안채|전단채/, cat: "채권" },
    { keys: ["현금", "현금성", "단기채", "파킹", "머니마켓"], label: "현금성", codes: ["153130"], re: /단기채|머니마켓|KOFR|CD금리|단기자금|SOFR/, cat: "현금성" },
    { keys: ["레버리지", "인버스", "곱버스", "2x"], label: "레버리지·인버스", codes: [], lev: true },
    { keys: ["코스피", "코스피200", "국내주식", "한국주식"], label: "국내주식", codes: ["069500", "237350"], cat: "국내주식" },
    { keys: ["코스닥", "코스닥150"], label: "코스닥", codes: [], re: /코스닥/ },
    { keys: ["배당", "고배당", "배당주"], label: "배당", codes: [], re: /배당/ },
    { keys: ["리츠"], label: "리츠", codes: [], re: /리츠/ },
    { keys: ["일본", "니케이"], label: "일본", codes: [], re: /일본|니케이/ },
    { keys: ["중국", "차이나", "항셍"], label: "중국", codes: [], re: /차이나|중국|항셍/ },
    { keys: ["2차전지", "이차전지"], label: "2차전지", codes: [], re: /2차전지/ },
    { keys: ["해외주식"], label: "해외주식", codes: [], cat: "해외주식" },
    { keys: ["테마"], label: "테마", codes: [], cat: "테마" },
  ];
  const NL_RANK_STOP = new Set(("조합 포트 포트폴리오 높은 높았던 순 순서 기준 동안 중 중에서 에서 것 거 보여줘 보여 줘 알려줘 찾아줘 찾아 줘 " +
    "어떤 뭐 무엇 etf 종목 3종목 3개 세개 세 개 로 으로 은 는 이 가 을 를 과 와 랑 이랑 하고 및 그리고 년 기간 결과 해줘 수익률 수익 cagr 낙폭 mdd 한도 " +
    "이내 이하 까지 안 제한 없음 없이 최근 격자 과거").split(/\s+/));

  function compact(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, "");
  }
  // 길이 보존 정규화(전각 → 반각, 소문자) — 위치를 원문에 그대로 대응시키기 위해
  function normKeepLen(s) {
    let out = "";
    for (const ch of String(s || "")) {
      const c = ch.charCodeAt(0);
      let o = ch;
      if (c >= 0xff01 && c <= 0xff5e) o = String.fromCharCode(c - 0xfee0);
      else if (c === 0x3000) o = " ";
      o = o.toLowerCase();
      if (o.length !== ch.length) o = ch;
      out += o;
    }
    return out;
  }
  const isHangul = (ch) => !!ch && /[\uac00-\ud7a3]/.test(ch);
  const isWordCh = (ch) => !!ch && /[\uac00-\ud7a3a-z0-9&]/i.test(ch);
  const isLevName = (name) => /레버리지|인버스|2X|곱버스/i.test(name || "");

  function blank(t, s, e) {
    return t.slice(0, s) + " ".repeat(e - s) + t.slice(e);
  }

  /** ctx: { etfs: meta.etfs, presets: PRESETS } → 사전 */
  function nlBuildDict(ctx) {
    const etfs = (ctx && ctx.etfs) || [];
    const byCode = new Map(etfs.map((e) => [e.code, e]));
    const entries = []; // {key, kind, prio, ...}
    const dropped = [];
    const has = (c) => byCode.has(c);
    for (const f of NL_FAMILIES) {
      if (!has(f.code)) { dropped.push(f.code); continue; }
      const fam = {
        code: f.code,
        cc: f.cc && has(f.cc) ? f.cc : null,
        h: f.h && has(f.h) ? f.h : null,
        alts: (f.alts || []).filter(([c]) => has(c)),
        warn: f.warn || null,
      };
      for (const k of f.keys) entries.push({ key: compact(k), kind: "alias", prio: 3, fam, word: k });
    }
    const presets = (ctx && ctx.presets) || {};
    const addPreset = (k, pk) => {
      if (presets[pk]) entries.push({ key: compact(k), kind: "preset", prio: 2, preset: pk, word: k });
    };
    for (const [k, pk] of Object.entries(NL_PRESET_KEYS)) addPreset(k, pk);
    for (const [pk, p] of Object.entries(presets)) {
      const lab = String(p.label || "").replace(/[^\uac00-\ud7a3a-zA-Z0-9+/&-]/g, "");
      if (lab && pk !== "usDivDowKR") addPreset(lab, pk);
    }
    // 정확한 코드 (레버리지 코드도 직접 입력은 허용 — 화면에 표시)
    for (const e of etfs) entries.push({ key: compact(e.code), kind: "code", prio: 4, code: e.code, word: e.code });
    // 공식 이름 전체 / 운용사 접두어를 뺀 이름 (레버리지·인버스는 이름으로 잡지 않음)
    const partial = new Map();
    for (const e of etfs) {
      if (e.leveraged || isLevName(e.name)) continue;
      entries.push({ key: compact(e.name), kind: "name", prio: 1, code: e.code, word: e.name });
      const parts = String(e.name).split(/\s+/);
      if (parts.length > 1) {
        const p = compact(parts.slice(1).join(""));
        if (p.length >= 3 && /[^0-9]/.test(p)) {
          if (!partial.has(p)) partial.set(p, []);
          partial.get(p).push(e);
        }
      }
    }
    for (const [p, list] of partial) {
      // 같은 이름(같은 지수)이 여럿이면 상장 이력이 가장 긴 것 (동률이면 meta 순서 = 시총순)
      const best = list.slice().sort((a, b) => String(a.start || "9").localeCompare(String(b.start || "9")))[0];
      entries.push({ key: p, kind: "name", prio: 0, code: best.code, word: best.name });
    }
    for (const [k, kind] of NL_MODS) entries.push({ key: compact(k), kind: "mod", mod: kind, prio: 5, word: k });
    entries.push({ key: "반반", kind: "half", prio: 5, word: "반반" });
    entries.sort((a, b) => b.key.length - a.key.length || b.prio - a.prio);
    const baskets = {};
    for (const [k, list] of Object.entries(NL_BASKETS)) baskets[k] = list.filter(has);
    return { entries, byCode, dropped, baskets, presets };
  }

  // t[i..]에서 key를 공백 무시하고 맞춘다 → 끝 위치 or -1
  function matchAt(t, i, key) {
    let j = i, k = 0;
    while (k < key.length) {
      if (j >= t.length) return -1;
      const ch = t[j];
      if (ch === " " && k > 0) { j++; continue; }
      if (ch !== key[k]) return -1;
      j++; k++;
    }
    return j;
  }

  function particleOnly(w) {
    let s = w;
    for (let guard = 0; guard < 3 && s; guard++) {
      const p = NL_PARTICLES.find((x) => s === x);
      if (p) return true;
      const q = NL_PARTICLES.find((x) => s.startsWith(x) && NL_STOP.has(s.slice(x.length)));
      if (q) return true;
      break;
    }
    return false;
  }

  function fmtW(w) {
    const r = Math.round(w * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  function roundTo100(ws) {
    // 0.1 단위로 반올림, 잔차는 가장 큰 비중에 (합 = 100)
    const r = ws.map((w) => Math.round(w * 10) / 10);
    const diff = Math.round((100 - r.reduce((a, b) => a + b, 0)) * 10) / 10;
    if (diff !== 0 && r.length) {
      let bi = 0;
      r.forEach((w, i) => { if (w > r[bi]) bi = i; });
      r[bi] = Math.round((r[bi] + diff) * 10) / 10;
    }
    return r;
  }

  function addMonthsLocal(endIso, years, months) {
    const dt = new Date(endIso + "T00:00:00");
    if (years) dt.setFullYear(dt.getFullYear() - years);
    if (months) dt.setMonth(dt.getMonth() - months);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** 문장 → 해석. 순수 함수(브라우저·node 공용). ctx = {etfs, presets, dict?} */
  function nlParse(text, ctx) {
    const dict = (ctx && ctx.dict) || nlBuildDict(ctx);
    const out = {
      input: String(text || ""),
      ok: false, refuse: false, empty: false,
      items: [], presetKey: null, basket: null,
      period: { kind: "max", label: "최장", isDefault: true },
      rebalance: null, rebalanceLabel: null,
      dca: null, initialCapital: null,
      weightMode: null, weightNote: "", proportional: false,
      notes: [], warns: [], errors: [], unknown: [], alts: [],
    };
    const orig = out.input;
    let t = normKeepLen(orig);
    if (!t.trim()) { out.empty = true; return out; }
    NL_RANK_RE.lastIndex = 0; NL_RANK_SHALLOW_RE.lastIndex = 0;
    if (NL_RANK_RE.test(t) || NL_RANK_SHALLOW_RE.test(t)) return nlParseRank(orig, t, dict);
    if (NL_REFUSE_RE.test(t)) { out.refuse = true; out.errors.push(NL_REFUSE_MSG, NL_REFUSE_RANK_MSG); return out; }

    // 1) 리밸런싱 (「1년 리밸」이 기간으로 잡히지 않게 먼저)
    const rebRules = [
      [/리밸\S*\s*(없이|없음|없는|안\s*함|안\s*하고|안하고|안함|x\b|no\b)|바이\s*앤\s*홀드|buy\s*and\s*hold|사서\s*보유|그냥\s*보유/, "N", "리밸런싱 없음"],
      [/(분기|3\s*개월|석\s*달)\s*(마다|별|에\s*한\s*번|1회)?\s*리밸\S*/, "Q", "분기 리밸런싱"],
      [/(연간|연|매년|해마다|일\s*년|1\s*년)\s*(마다|에\s*한\s*번|1회|한\s*번)?\s*리밸\S*/, "Y", "연 1회 리밸런싱"],
      [/(매월|매달|월간|한\s*달|1\s*개월|월)\s*(마다|1회|한\s*번)?\s*리밸\S*/, "M", "매월 리밸런싱"],
    ];
    for (const [re, code, label] of rebRules) {
      const m = re.exec(t);
      if (m) { out.rebalance = code; out.rebalanceLabel = label; t = blank(t, m.index, m.index + m[0].length); break; }
    }

    // 2) 금액: 매월 적립 / 시작 원금
    const money = (num, unit) => {
      const v = Number(num);
      const u = compact(unit);
      if (u.startsWith("억")) return v * 1e8;
      if (u.startsWith("천만")) return v * 1e7;
      if (u.startsWith("백만")) return v * 1e6;
      if (u.startsWith("만")) return v * 1e4;
      return v;
    };
    {
      const re = /(매월|매달|달마다|월)\s*(\d+(?:\.\d+)?)\s*(억\s*원|억|천만\s*원|천만|백만\s*원|백만|만\s*원|만|원)\s*(씩)?\s*(적립|투자|넣|납입|모으|매수|추가)?\S*/;
      const m = re.exec(t);
      if (m) {
        out.dca = { monthly: money(m[2], m[3]) };
        t = blank(t, m.index, m.index + m[0].length);
      }
      const re2 = /(?:(초기|원금|시작|일시금|목돈|처음)\s*(자금|금액)?\s*(\d+(?:\.\d+)?)\s*(억\s*원|억|천만\s*원|천만|백만\s*원|백만|만\s*원|만|원)|(\d+(?:\.\d+)?)\s*(억\s*원|억|천만\s*원|천만|백만\s*원|백만|만\s*원|만|원)\s*(으로\s*시작|으로|시작|일시금|원금|목돈|로\s*시작))\S*/;
      const m2 = re2.exec(t);
      if (m2) {
        out.initialCapital = m2[3] ? money(m2[3], m2[4]) : money(m2[5], m2[6]);
        t = blank(t, m2.index, m2.index + m2[0].length);
      }
    }

    // 3) 기간 먼저 떼기 (그 다음 남은 숫자 = 비중)
    const BOND_BEFORE = /(국고채|국채|채|미국채)\s*$/;
    const BOND_AFTER = /^\s*(국채|국고채|만기|물)/;
    {
      let m;
      const rangeRe = /(\d{4}-\d{2}-\d{2})\s*(?:~|부터|-)\s*(\d{4}-\d{2}-\d{2})?(\s*까지)?/;
      if ((m = rangeRe.exec(t))) {
        out.period = { kind: "custom", start: m[1], end: m[2] || null, label: `${m[1]}~${m[2] || "최근"}` };
        t = blank(t, m.index, m.index + m[0].length);
      } else {
        const fromRe = /((?:19|20)\d{2})\s*(?:년\s*(?:부터|이후)?|부터|이후|~)\s*(?:~\s*)?(?:((?:19|20)\d{2})\s*년?\s*(까지)?)?/;
        if ((m = fromRe.exec(t))) {
          out.period = { kind: "from", startYear: Number(m[1]), endYear: m[2] ? Number(m[2]) : null,
            label: `${m[1]}년부터${m[2] ? ` ${m[2]}년까지` : ""}` };
          t = blank(t, m.index, m.index + m[0].length);
        }
      }
      const longRe = /가능한\s*최장|가능한\s*길게|최대한\s*길게|최대한\s*오래|최대\s*기간|전체\s*기간|최장|최대|가장\s*길게|길게/;
      if (out.period.isDefault && (m = longRe.exec(t))) {
        out.period = { kind: "max", label: "최장" };
        t = blank(t, m.index, m.index + m[0].length);
      }
      const yrRe = /(?:최근\s*)?(\d{1,2})\s*(년|개월|달(?!러))\s*(간|동안|치)?/g;
      let found = null;
      t = t.replace(yrRe, (all, n, unit, _s, off) => {
        if (found) return all;
        const lead = all.search(/\d/);
        if (/\d/.test(t[off + lead - 1] || "")) return all;
        if (unit === "년" && (BOND_BEFORE.test(t.slice(0, off)) || BOND_AFTER.test(t.slice(off + all.length)))) return all;
        found = { n: Number(n), unit };
        return " ".repeat(all.length);
      });
      if (found && out.period.isDefault) {
        if (found.unit === "년") out.period = { kind: "years", years: found.n, label: `${found.n}년` };
        else out.period = { kind: "months", months: found.n, label: `${found.n}개월` };
      } else if (found && !out.period.isDefault) {
        out.notes.push(`기간이 두 번 적혀 앞의 「${out.period.label}」만 썼어요`);
      }
    }

    // 4) 「배당 위주 3종목」
    {
      const bre = /(배당|반도체|채권)\s*(위주|중심|으로|만)?\s*(\d{1,2})\s*(종목|개|종)/;
      const m = bre.exec(t);
      if (m) {
        const list = dict.baskets[m[1]] || [];
        const n = Math.max(1, Math.min(Number(m[3]), list.length));
        if (Number(m[3]) > list.length) out.notes.push(`${m[1]} 묶음은 ${list.length}종까지라 ${list.length}종만 썼어요`);
        out.basket = { theme: m[1], n, codes: list.slice(0, n) };
        t = blank(t, m.index, m.index + m[0].length);
      }
    }

    // 5) 비례 키워드 (합이 100 미만일 때 현금 대신 비례 맞춤)
    {
      const m = /비례\s*(맞춤|조정)?/.exec(t);
      if (m) { out.proportional = true; t = blank(t, m.index, m.index + m[0].length); }
    }

    // 6) 스캔: 종목/프리셋/수식어/숫자
    const toks = [];
    const unknownBuf = [];
    let cur = "";
    const flush = () => { if (cur) unknownBuf.push(cur); cur = ""; };
    let i = 0;
    while (i < t.length) {
      const ch = t[i];
      if (ch === " ") { flush(); i++; continue; }
      // 숫자 (비중)
      const nm = /^(\d+(?:\.\d+)?)\s*(%|퍼센트|퍼|프로)?/.exec(t.slice(i));
      if (nm && !isWordCh(t[i - 1] || "") || (nm && /\d/.test(ch) && !cur)) {
        if (nm) {
          // 숫자로 시작하는 키(60/40, 2차전지, 코드 등)가 있으면 그쪽 우선
          let keyHit = null;
          for (const en of dict.entries) {
            if (en.key[0] !== ch) continue;
            const e = matchAt(t, i, en.key);
            if (e > 0 && (en.kind !== "code" || !isWordCh(t[e] || "") || !/\d/.test(t[e]))) { keyHit = { en, e }; break; }
          }
          if (!keyHit) {
            flush();
            toks.push({ type: "num", v: Number(nm[1]), pct: !!nm[2], s: i, e: i + nm[0].length, raw: nm[0].trim() });
            i += nm[0].length;
            continue;
          }
        }
      }
      let hit = null;
      for (const en of dict.entries) {
        if (en.key[0] !== ch) continue;
        const e = matchAt(t, i, en.key);
        if (e < 0) continue;
        // 한 글자 키(금)는 앞뒤가 단어 경계일 때만
        if (en.key.length === 1) {
          if (isHangul(t[i - 1]) || /[a-z]/.test(t[i - 1] || "")) continue;
          const nx = t[e] || "";
          if (isHangul(nx) && !NL_PARTICLES.some((p) => t.startsWith(p, e))) continue;
        }
        // 코드 키는 뒤에 숫자/영문이 붙으면 안 됨
        if (en.kind === "code" && /[0-9a-z]/.test(t[e] || "")) continue;
        hit = { en, e };
        break;
      }
      if (hit) {
        flush();
        toks.push({ type: hit.en.kind, en: hit.en, s: i, e: hit.e, raw: orig.slice(i, hit.e) });
        i = hit.e;
        continue;
      }
      cur += orig[i];
      i++;
    }
    flush();

    for (const w of unknownBuf) {
      const c = compact(w).replace(/^[\s,.·/+&()[\]~!?:;'"=-]+|[\s,.·/+&()[\]~!?:;'"=-]+$/g, "");
      if (!c) continue;
      if (NL_STOP.has(c) || particleOnly(c)) continue;
      const stripped = NL_PARTICLES.reduce((s, p) => (s.endsWith(p) && s.length > p.length ? s.slice(0, -p.length) : s), c);
      if (NL_STOP.has(stripped)) continue;
      if (/^[,.·/+&()[\]~!?:;'"=-]+$/.test(c)) continue;
      out.unknown.push(w.trim());
    }

    // 프리셋
    const presetTok = toks.find((x) => x.type === "preset");
    const assetToks = toks.filter((x) => x.type === "alias" || x.type === "name" || x.type === "code");
    const modToks = toks.filter((x) => x.type === "mod");
    const halfTok = toks.find((x) => x.type === "half");

    // 수식어(레버리지/커버드콜/환헤지) → 바로 앞(없으면 바로 뒤) 종목에 붙인다. 버리고 넘어가지 않는다.
    for (const mt of modToks) {
      const idx = toks.indexOf(mt);
      let target = null;
      const prev = toks[idx - 1], next = toks[idx + 1];
      if (prev && (prev.type === "alias" || prev.type === "name" || prev.type === "code")) target = prev;
      else if (next && (next.type === "alias" || next.type === "name" || next.type === "code")) target = next;
      const kind = mt.en.mod;
      if (kind === "lev") {
        out.errors.push(`「${(target ? target.raw + " " : "") + mt.raw}」: 레버리지·인버스·곱버스·2X는 지원 안 함 (쉬운 입력)`);
        continue;
      }
      if (kind === "unh") { continue; }
      if (!target) { out.errors.push(`「${mt.raw}」가 어느 종목에 붙는지 모르겠어요`); continue; }
      if (target.type !== "alias") {
        out.errors.push(`「${target.raw} ${mt.raw}」는 이해하지 못했어요. 정확한 ETF 이름이나 코드를 적어 주세요`);
        continue;
      }
      const v = kind === "cc" ? target.en.fam.cc : target.en.fam.h;
      if (!v) {
        out.errors.push(`「${target.raw} ${mt.raw}」에 맞는 ETF가 목록에 없어 지원 안 함`);
        continue;
      }
      target.variant = v;
      target.modLabel = kind === "cc" ? "커버드콜" : "환헤지";
    }

    if (presetTok) {
      const pk = presetTok.en.preset;
      const p = dict.presets[pk];
      out.presetKey = pk;
      out.presetLabel = String(p.label || pk).replace(/^[^\uac00-\ud7a3A-Za-z0-9]+/, "").trim();
      for (const [code, w] of Object.entries(p.w)) {
        if (dict.byCode.has(code)) out.items.push({ code, name: dict.byCode.get(code).name, weight: w, src: "preset" });
      }
      out.weightMode = "preset";
      out.weightNote = `프리셋 「${out.presetLabel}」 비중`;
      if (assetToks.length || out.basket) out.notes.push(`프리셋과 같이 적은 종목(${assetToks.map((a) => a.raw).join(", ")})은 쓰지 않았어요`);
      if (toks.some((x) => x.type === "num")) out.notes.push("프리셋 뒤 숫자는 쓰지 않았어요(프리셋 비중 그대로)");
      if (out.errors.length) return out;
      out.ok = out.items.length > 0;
      if (!out.ok) out.errors.push("프리셋 종목이 목록에 없습니다");
      return out;
    }

    // 종목 + 비중 배정
    const seq = toks.filter((x) => x.type !== "mod" && x.type !== "half");
    const assets = [];
    const orphanNums = [];
    const numBefore = seq.length && seq[0].type === "num";
    if (numBefore) {
      // 「60% 나스닥 40% 금」
      let pending = null;
      for (const x of seq) {
        if (x.type === "num") { if (pending) orphanNums.push(pending); pending = x; }
        else { assets.push({ tok: x, w: pending ? pending.v : null }); pending = null; }
      }
      if (pending) orphanNums.push(pending);
    } else {
      for (const x of seq) {
        if (x.type === "num") {
          const last = assets[assets.length - 1];
          if (last && last.w == null && last.lastSeq === seq.indexOf(x) - 1) last.w = x.v;
          else orphanNums.push(x);
        } else {
          assets.push({ tok: x, w: null, lastSeq: seq.indexOf(x) });
        }
      }
    }
    for (const n of orphanNums) out.errors.push(`숫자 「${n.raw}」가 어느 종목 비중인지 모르겠어요`);

    if (out.basket) {
      for (const c of out.basket.codes) assets.push({ basketCode: c, w: null });
    }

    // 코드 확정 + 중복 합치기
    const merged = new Map();
    for (const a of assets) {
      let code, src, alts = [], warn = null, word = null, span = null, modLabel = null;
      if (a.basketCode) { code = a.basketCode; src = "basket"; }
      else {
        const en = a.tok.en;
        span = [a.tok.s, a.tok.e];
        word = a.tok.raw.trim();
        if (en.kind === "alias") {
          code = a.tok.variant || en.fam.code;
          src = "alias";
          modLabel = a.tok.modLabel || null;
          if (!a.tok.variant) alts = en.fam.alts;
          warn = en.fam.warn;
        } else { code = en.code; src = en.kind; }
      }
      const etf = dict.byCode.get(code);
      if (!etf) { out.errors.push(`${code}는 목록에 없습니다`); continue; }
      if (src === "code" && (etf.leveraged || isLevName(etf.name))) out.warns.push(`${code} ${etf.name}: 레버리지/인버스 ETF(코드 직접 입력)`);
      if (warn && !out.warns.includes(warn)) out.warns.push(warn);
      if (merged.has(code)) {
        const m = merged.get(code);
        if (a.w != null) m.weight = (m.weight || 0) + a.w;
        out.notes.push(`${code} ${etf.name}가 두 번 나와 비중을 합쳤어요`);
        continue;
      }
      merged.set(code, { code, name: etf.name, weight: a.w, src, word, span, modLabel,
        alts: alts.map(([c, w]) => ({ code: c, name: dict.byCode.get(c).name, word: w })) });
    }
    let items = [...merged.values()];

    if (!items.length) {
      if (!out.errors.length) out.empty = true;
      return out;
    }

    // 비중 규칙 (조용히 바꾸지 않는다 — 무엇을 했는지 weightNote로 보여 준다)
    const given = items.filter((x) => x.weight != null);
    const none = items.filter((x) => x.weight == null);
    const zero = given.filter((x) => !(x.weight > 0));
    if (zero.length) {
      out.notes.push(`비중 0인 ${zero.map((x) => x.code).join(", ")}는 뺐어요`);
      items = items.filter((x) => !(x.weight != null && !(x.weight > 0)));
    }
    const S = items.filter((x) => x.weight != null).reduce((a, b) => a + b.weight, 0);
    if (!given.length) {
      if (halfTok && items.length === 2) {
        items.forEach((x) => (x.weight = 50));
        out.weightMode = "half"; out.weightNote = "반반 → 50/50";
      } else {
        if (halfTok) out.notes.push("반반은 두 종목일 때만 써요 → 동일비중");
        const r = roundTo100(items.map(() => 100 / items.length));
        items.forEach((x, k) => (x.weight = r[k]));
        out.weightMode = "equal";
        out.weightNote = out.basket && items.every((x) => x.src === "basket")
          ? `${out.basket.theme} 위주 ${out.basket.n}종목 → 상장 이력이 긴 순서로 ${out.basket.n}종 · 동일비중`
          : "비중을 안 적어서 동일비중";
      }
    } else if (none.length) {
      const rest = 100 - S;
      if (rest <= 0) {
        out.errors.push(`비중 합이 이미 ${fmtW(S)}라 비중 없는 ${none.map((x) => x.word || x.code).join(", ")}에 나눌 몫이 없어요. 비중을 적어 주세요`);
        return out;
      }
      none.forEach((x) => (x.weight = rest / none.length));
      const r = roundTo100(items.map((x) => x.weight));
      items.forEach((x, k) => (x.weight = r[k]));
      out.weightMode = "fill";
      out.weightNote = `비중 없는 ${none.length}종목이 나머지 ${fmtW(rest)}을 똑같이 나눔`;
    } else if (Math.abs(S - 100) < 1e-9) {
      out.weightMode = "given"; out.weightNote = "적은 비중 그대로 (합 100)";
    } else if (S < 100 && !out.proportional) {
      const rest = 100 - S;
      const cashCode = "153130";
      const cashEtf = dict.byCode.get(cashCode);
      if (!cashEtf) { out.errors.push("현금(153130)이 목록에 없어 합을 맞출 수 없어요"); return out; }
      const ex = items.find((x) => x.code === cashCode);
      if (ex) ex.weight += rest;
      else items.push({ code: cashCode, name: cashEtf.name, weight: rest, src: "cashfill", alts: [] });
      out.weightMode = "cash";
      out.weightNote = `합 ${fmtW(S)} → 나머지 ${fmtW(rest)}은 현금(${cashCode} ${cashEtf.name})`;
      out.alts.push({ label: "비례 맞춤으로 바꾸기", append: " 비례" });
    } else {
      const r = roundTo100(items.map((x) => (x.weight * 100) / S));
      items.forEach((x, k) => (x.weight = r[k]));
      out.weightMode = "prop";
      out.weightNote = `합 ${fmtW(S)} → 비례 맞춤`;
    }

    // 다른 선택지 칩 (반도체 → 미국반도체 등)
    for (const it of items) {
      for (const a of it.alts || []) {
        if (items.some((x) => x.code === a.code)) continue;
        out.alts.push({ label: `${a.word}(${a.code} ${a.name})로 바꾸기`, span: it.span, replace: a.word });
      }
    }
    out.items = items;
    out.ok = !out.errors.length && items.length > 0;
    return out;
  }

  function nlGroupCodes(g, dict) {
    const out = new Set();
    for (const c of g.codes) if (dict.byCode.has(c)) out.add(c);
    for (const e of dict.byCode.values()) {
      const lev = e.leveraged || isLevName(e.name);
      if (g.lev) { if (lev) out.add(e.code); continue; }
      if (lev) continue;
      if (g.re && g.re.test(e.name)) out.add(e.code);
      if (g.cat && e.category === g.cat) out.add(e.code);
    }
    return [...out];
  }

  /** 순위 검색 문장 해석 (순수 함수). 거르는 조건: 기간·낙폭 한도·제외만. 포함은 미지원 표시. */
  function nlParseRank(orig, t0, dict) {
    const out = {
      input: orig, mode: "rank", ok: false, refuse: false, empty: false,
      items: [], notes: [], warns: [], errors: [], unknown: [], alts: [],
      rank: { period: "10y", periodLabel: "10년", periodDefault: true, cap: "none", capLabel: "낙폭 한도 없음", capDefault: true,
        excl: [], incl: [], shallow: false },
    };
    const R = out.rank;
    let t = t0;
    const blankAll = (re) => { t = t.replace(re, (m) => " ".repeat(m.length)); };
    NL_RANK_SHALLOW_RE.lastIndex = 0;
    if (NL_RANK_SHALLOW_RE.test(t)) { R.shallow = true; NL_RANK_SHALLOW_RE.lastIndex = 0; blankAll(NL_RANK_SHALLOW_RE); }
    NL_RANK_RE.lastIndex = 0;
    const hasCagr = NL_RANK_RE.test(t);
    NL_RANK_RE.lastIndex = 0;
    blankAll(NL_RANK_RE);
    if (R.shallow) {
      if (hasCagr) out.notes.push("「낙폭이 얕은 순」 정렬은 미지원 — 수익률 순서에 낙폭 한도(25·30·40%)만 걸 수 있어요");
      else { out.errors.push("낙폭이 얕은 순 정렬은 미지원입니다. 수익률 순서에 낙폭 한도(25·30·40%)를 걸어 주세요 (예: 5년 수익률 높은 조합 낙폭 30% 이내)"); }
    }
    // 낙폭 한도
    let m;
    const capNone = /(낙폭|mdd)\s*(한도|제한)?\s*(는|은)?\s*(없이|없음|무제한|상관\s*없)/i;
    const capRe = /(?:최대\s*)?(?:낙폭|mdd|하락)\s*(?:은|이|가)?\s*(?:한도)?\s*[-−–]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:%|퍼센트|프로)?\s*(?:이내|이하|까지|안쪽|안|미만|아래|넘지\s*않[게는은]?|못\s*넘게)?|[-−–]\s*(\d{1,2}(?:\.\d+)?)\s*%\s*(?:이내|이하|까지|안)?/i;
    if ((m = capNone.exec(t))) {
      R.capDefault = false; R.capLabel = "낙폭 한도 없음";
      t = blank(t, m.index, m.index + m[0].length);
    } else if ((m = capRe.exec(t))) {
      const n = Number(m[1] || m[2]);
      t = blank(t, m.index, m.index + m[0].length);
      if (NL_RANK_CAPS[n]) { R.cap = NL_RANK_CAPS[n]; R.capLabel = `낙폭 한도 −${n}%`; R.capDefault = false; }
      else out.errors.push(`낙폭 한도 ${n}%는 격자에 없어요. 25·30·40% 또는 제한 없음만 있습니다`);
    }
    // 기간 (격자는 1·3·5·10년만, 최장 없음)
    const longRe = /가능한\s*최장|가능한\s*길게|최대한\s*길게|최장|최대\s*기간|전체\s*기간/;
    if ((m = longRe.exec(t))) { out.errors.push("격자 순위는 1년·3년·5년·10년만 있습니다(최장 없음)"); t = blank(t, m.index, m.index + m[0].length); }
    const perRe = /(?:최근\s*)?(\d{1,2})\s*(년|개월|달)\s*(간|동안)?/;
    if ((m = perRe.exec(t))) {
      const n = Number(m[1]);
      t = blank(t, m.index, m.index + m[0].length);
      if (m[2] === "년" && NL_RANK_PERIODS[n]) { R.period = NL_RANK_PERIODS[n]; R.periodLabel = `${n}년`; R.periodDefault = false; }
      else out.errors.push(`격자 순위는 1년·3년·5년·10년만 있습니다(${m[0].trim()} 없음)`);
    }
    // 제외/포함 스캔
    const gEntries = [];
    for (const g of NL_GROUPS) for (const k of g.keys) gEntries.push({ key: compact(k), kind: "group", g, prio: 9 });
    const kw = [
      ...["제외하고", "제외한", "제외", "빼고", "뺀", "빼서", "빼", "없이", "없는", "말고"].map((k) => ({ key: k, kind: "excl", prio: 10 })),
      ...["포함한", "포함", "들어간", "들어가는", "들어있는", "넣은", "넣고", "있는"].map((k) => ({ key: k, kind: "incl", prio: 10 })),
    ];
    const entries = [...kw, ...gEntries, ...dict.entries.filter((e) => e.kind === "alias" || e.kind === "name" || e.kind === "code")]
      .sort((a, b) => b.key.length - a.key.length || b.prio - a.prio);
    const toks = [];
    const unk = [];
    let cur = "";
    const flush = () => { if (cur) unk.push(cur); cur = ""; };
    for (let i = 0; i < t.length;) {
      const ch = t[i];
      if (ch === " ") { flush(); i++; continue; }
      let hit = null;
      for (const en of entries) {
        if (en.key[0] !== ch) continue;
        const e = matchAt(t, i, en.key);
        if (e < 0) continue;
        if (en.key.length === 1 && (isHangul(t[i - 1]) || (isHangul(t[e]) && !NL_PARTICLES.some((p) => t.startsWith(p, e)) && t[e] !== "만"))) continue;
        if (en.kind === "code" && /[0-9a-z]/.test(t[e] || "")) continue;
        hit = { en, e };
        break;
      }
      if (hit) {
        flush();
        const tok = { en: hit.en, raw: orig.slice(i, hit.e).trim() };
        // 「X만」 → 포함(미지원)
        if (hit.en.kind !== "excl" && hit.en.kind !== "incl" && t[hit.e] === "만") { toks.push(tok); toks.push({ en: { kind: "incl" }, raw: "만" }); i = hit.e + 1; continue; }
        toks.push(tok); i = hit.e; continue;
      }
      cur += orig[i]; i++;
    }
    flush();
    let pending = [];
    for (const tk of toks) {
      const k = tk.en.kind;
      if (k === "excl" || k === "incl") {
        if (!pending.length) { out.notes.push(`「${tk.raw}」 앞에 종목·분류가 없어 쓰지 않았어요`); continue; }
        for (const p of pending) (k === "excl" ? R.excl : R.incl).push(p);
        pending = [];
      } else pending.push(tk);
    }
    for (const p of pending) out.notes.push(`「${p.raw}」 뒤에 제외/빼고가 없어 거르지 않았어요`);
    // 제외 코드 풀어 쓰기
    R.excl = R.excl.map((tk) => {
      if (tk.en.kind === "group") return { word: tk.raw, label: tk.en.g.label, codes: nlGroupCodes(tk.en.g, dict) };
      if (tk.en.kind === "alias") {
        const f = tk.en.fam;
        return { word: tk.raw, label: tk.raw, codes: [...new Set([f.code, f.cc, f.h].filter(Boolean))] };
      }
      return { word: tk.raw, label: tk.raw, codes: [tk.en.code] };
    });
    R.incl = R.incl.map((tk) => tk.raw);
    if (R.incl.length) out.notes.push(`포함(「${R.incl.join("」「")}」 포함/만): 미지원 — 이번 버전은 제외·기간·낙폭 한도만 거릅니다. 포함 조건으로 거르지 않았어요`);
    for (const w of unk) {
      const c = compact(w).replace(/^[\s,.·/+&()[\]~!?:;'"=-]+|[\s,.·/+&()[\]~!?:;'"=-]+$/g, "");
      if (!c || NL_RANK_STOP.has(c) || NL_STOP.has(c) || particleOnly(c)) continue;
      const st = NL_PARTICLES.reduce((s2, p) => (s2.endsWith(p) && s2.length > p.length ? s2.slice(0, -p.length) : s2), c);
      if (NL_RANK_STOP.has(st) || NL_STOP.has(st)) continue;
      if (/^\d+$/.test(c)) { out.errors.push(`숫자 「${w.trim()}」를 어디에 쓰는지 모르겠어요`); continue; }
      out.unknown.push(w.trim());
    }
    out.ok = !out.errors.length;
    return out;
  }

  /** 미리 계산된 전 조합 목록에서 거르기만 한다. 0행이면 0행. 조건을 풀지 않는다. */
  function nlRankFilter(rank, data, dict, limit = 10) {
    const info = data && data.periods && data.periods[rank.period];
    if (!info || info.skipped || !info.caps || !info.caps[rank.cap]) return { error: "이 기간·한도 격자 데이터가 없습니다" };
    const pool = info.pool;
    const excl = new Set();
    for (const x of rank.excl) for (const c of x.codes) excl.add(c);
    const removed = pool.filter((c) => excl.has(c));
    const block = info.caps[rank.cap];
    const keep = block.rows.filter((r) => !excl.has(pool[r[0]]) && !excl.has(pool[r[1]]) && !excl.has(pool[r[2]]));
    const rows = keep.slice(0, limit).map((r) => ({
      tickers: [pool[r[0]], pool[r[1]], pool[r[2]]],
      names: [info.names[r[0]], info.names[r[1]], info.names[r[2]]],
      weights: [r[3], r[4], r[5]], cagr: r[6], total: r[7], mdd: r[8],
    }));
    return { start: info.start, end: info.end, days: info.days, poolN: info.pool_n, pool, poolNames: info.names,
      removed, totalN: block.n, n: keep.length, rows };
  }

  /** 해석된 기간 → [start|null, end, statePeriod] (기존 periodBounds 규칙과 같은 로컬 달력) */
  function nlPeriodPlan(period, latestEnd) {
    const p = period || { kind: "max" };
    const preset = { 1: "1y", 3: "3y", 5: "5y", 10: "10y" };
    if (p.kind === "max") return { statePeriod: "max" };
    if (p.kind === "years" && preset[p.years]) return { statePeriod: preset[p.years] };
    if (p.kind === "years") return { statePeriod: "custom", start: addMonthsLocal(latestEnd, p.years, 0), end: latestEnd };
    if (p.kind === "months") return { statePeriod: "custom", start: addMonthsLocal(latestEnd, 0, p.months), end: latestEnd };
    if (p.kind === "from") {
      const end = p.endYear ? (`${p.endYear}-12-31` < latestEnd ? `${p.endYear}-12-31` : latestEnd) : latestEnd;
      return { statePeriod: "custom", start: `${p.startYear}-01-01`, end };
    }
    if (p.kind === "custom") return { statePeriod: "custom", start: p.start, end: p.end && p.end < latestEnd ? p.end : latestEnd };
    return { statePeriod: "max" };
  }

  const api = { nlParse, nlBuildDict, nlPeriodPlan, nlRankFilter, NL_EXAMPLES, NL_REFUSE_MSG, NL_REFUSE_RANK_MSG, fmtW };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NL = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ===================== 브라우저 연결 (app.js의 state / run() 재사용) =====================
const nlUi = { dict: null, owned: { rebal: false, dca: false }, last: null, busy: false, booted: false, deep: null, rankLast: null };

function nlEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function nlDict() {
  if (!nlUi.dict && typeof state !== "undefined" && state.meta) {
    nlUi.dict = NL.nlBuildDict({ etfs: state.meta.etfs, presets: PRESETS });
  }
  return nlUi.dict;
}

function nlLatestEnd() {
  const ends = state.meta.etfs.map((e) => e.end).filter(Boolean).sort();
  return ends.at(-1);
}

const NL_REBAL_LABEL = { Q: "분기 리밸런싱", Y: "연 1회 리밸런싱", M: "매월 리밸런싱", N: "리밸런싱 없음",
  MOM: "월간 모멘텀", MOM12_1: "12-1 스킵 모멘텀", XSMOM: "XS 잔차 모멘텀", DMOM: "듀얼 모멘텀" };

/** 숨은 기본값 한 줄 + 기본값과 다른 고급 설정 목록 */
function nlSettingsSummary() {
  const tc = clampTradeCost(state.tradeCost);
  const parts = [NL_REBAL_LABEL[state.rebalance] || state.rebalance, `비용 ${(tc * 100).toFixed(2)}%`];
  const withdrawOn = !state.dcaOn && state.withdrawMode && state.withdrawMode !== "none";
  if (state.dcaOn) parts.push(`시작 ${won(state.initialCapital)} + 매월 ${won(state.monthlyAmount)} 적립`);
  else if (withdrawOn) parts.push(state.withdrawMode === "amount" ? `매월 ${won(state.withdrawAmount)} 인출` : `매월 잔액 ${(state.withdrawRate * 100).toFixed(1)}% 인출`);
  else parts.push("일시불입");
  const ov = [];
  if (state.maOverlay) ov.push(`이동평균 MA${state.maWindow}`);
  if (state.regimeHedge) ov.push("국면 헤지");
  if (state.goldOn) ov.push("금 슬리브");
  if (state.volTarget) ov.push("변동성 타깃");
  if (state.sleeveTrend) ov.push("슬리브 추세");
  if (state.bandOn) ov.push(`밴드 ${Math.round(clampBandPct(state.bandPct) * 100)}%`);
  if (state.weighting === "invVol") ov.push("역변동성 비중");
  parts.push(ov.length ? `오버레이: ${ov.join("·")}` : "오버레이 없음");
  const changed = [...ov];
  if (Math.round(tc * 10000) !== Math.round(TRADE_COST_DEFAULT * 10000)) changed.push(`비용 ${(tc * 100).toFixed(2)}%`);
  if (state.rebalance !== "Q" && !nlUi.owned.rebal) changed.push(NL_REBAL_LABEL[state.rebalance] || state.rebalance);
  if (state.dcaOn && !nlUi.owned.dca) changed.push("월 적립");
  if (withdrawOn) changed.push("인출");
  if (state.accountType === "pension") changed.push("연금 계좌 세금 모형");
  return { line: parts.join(" · "), changed };
}

function nlItemsLine(items) {
  return items.map((x) => `<span class="nl-item"><b>${nlEsc(x.code)}</b> ${nlEsc(x.name)} ${nlEsc(NL.fmtW(x.weight))}%</span>`).join(" · ");
}

/** 공통 시작일 때문에 요청 기간이 줄었는지 → 범인 종목 이름까지 */
function nlClipNote(periodLabel, isMax, codes) {
  const L = state.lastRun;
  if (!L || !L.result || L.result.error) return "";
  const r = L.result;
  const firsts = codes.map((c) => [c, firstAvailableDate(c)]).filter(([, d]) => d);
  if (!firsts.length) return "";
  const [cul, cd] = firsts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const etf = etfByCode(cul);
  // 연수·거래일은 「공통 기간」 카드와 같은 값(buildWindowInfo ← backtest 결과 years/days)만 쓴다
  const wi = L.windowInfo || {};
  const yrsNum = wi.years != null ? Number(wi.years) : Number(r.years);
  const days = wi.days != null ? wi.days : r.days;
  const span = `${r.start}~${r.end} · 약 ${Number.isFinite(yrsNum) ? yrsNum.toFixed(1) : "—"}년 · ${days}거래일`;
  const who = `${cul} ${etf ? etf.name : ""}(${cd.slice(0, 7)})`;
  if (isMax) return `최장 → 가장 늦게 시작한 ${nlEsc(who)} 기준 ${span}`;
  const req = L.requestedStart;
  if (req && r.start > req) {
    const gapDays = (new Date(r.start + "T00:00:00") - new Date(req + "T00:00:00")) / 86400000;
    if (gapDays > 10) return `${nlEsc(periodLabel)} 요청 → ${nlEsc(who)} 때문에 약 ${yrsNum.toFixed(1)}년 (${span})`;
  }
  return `${nlEsc(periodLabel)} → ${span}`;
}

function nlRender(html) {
  const box = document.getElementById("nlOut");
  if (box) box.innerHTML = html;
}

function nlHintHtml(msg) {
  const ex = NL.NL_EXAMPLES.map((e) => `「${nlEsc(e)}」`).join(" ");
  return `<div class="nl-hint">${nlEsc(msg)}<br />이렇게 적어 보세요: ${ex}</div>`;
}

function nlRenderInterp(p, opts = {}) {
  const sum = nlSettingsSummary();
  const codes = p.items.map((x) => x.code);
  const periodLabel = p.period ? (p.period.isDefault ? "최장(기간 안 적음)" : p.period.label) : "최장";
  const isMax = !p.period || p.period.kind === "max";
  const clip = nlClipNote(periodLabel, isMax, codes);
  const badge = sum.changed.length
    ? `<span class="nl-badge" title="${nlEsc(sum.changed.join(" · "))}">고급 설정 변경됨: ${nlEsc(sum.changed.join(" · "))}</span>`
    : "";
  const head = opts.prefix || "이렇게 이해했어요";
  let html = `<div class="nl-interp"><span class="nl-head">${nlEsc(head)}:</span> ${nlItemsLine(p.items)} · ${nlEsc(periodLabel)}</div>`;
  if (p.weightNote) html += `<div class="nl-line">비중: ${nlEsc(p.weightNote)}</div>`;
  if (clip) html += `<div class="nl-line">기간: ${clip}</div>`;
  html += `<div class="nl-line nl-defaults">설정: ${nlEsc(sum.line)} ${badge}</div>`;
  for (const w of p.warns || []) html += `<div class="nl-line nl-warn">⚠ ${nlEsc(w)}</div>`;
  for (const n of p.notes || []) html += `<div class="nl-line">· ${nlEsc(n)}</div>`;
  if (p.unknown && p.unknown.length) html += `<div class="nl-line nl-unk">이해하지 못한 말: ${p.unknown.map((u) => `「${nlEsc(u)}」`).join(" ")}</div>`;
  if (p.alts && p.alts.length) {
    html += `<div class="presets nl-alts">${p.alts.map((a, k) => `<button type="button" class="chip nl-alt" data-k="${k}">${nlEsc(a.label)}</button>`).join("")}</div>`;
  }
  nlRender(html);
  document.querySelectorAll("#nlOut .nl-alt").forEach((b) => {
    b.onclick = () => nlUseAlt(p, p.alts[Number(b.dataset.k)]);
  });
}

function nlUseAlt(p, alt) {
  const inp = document.getElementById("nlInput");
  if (!inp || !alt) return;
  let s = p.input;
  if (alt.append) s = s + alt.append;
  else if (alt.span) s = s.slice(0, alt.span[0]) + alt.replace + s.slice(alt.span[1]);
  inp.value = s;
  nlSubmit(s);
}

/** 해석을 기존 state에 넣고 기존 run()을 부른다. */
async function nlApply(p) {
  // 프리셋 칩·랭크 행 표시 정리 (applyPreset/applyRankRow와 같은 방식)
  if (typeof rankUi !== "undefined") rankUi.pick = null;
  document.querySelectorAll("#rankPanel .rank-row.active").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll("#presets .chip").forEach((el) => el.classList.toggle("active", !!p.presetKey && el.dataset.key === p.presetKey));
  state.activePreset = p.presetKey || null;
  state.selected = {};
  for (const it of p.items) state.selected[it.code] = it.weight;
  // 기간: 1/3/5/10년·최장은 기존 select 값, 그 밖은 기존 「직접 지정」 입력
  const plan = NL.nlPeriodPlan(p.period, nlLatestEnd());
  state.period = plan.statePeriod;
  const startEl = document.getElementById("startDate"), endEl = document.getElementById("endDate");
  if (plan.statePeriod === "custom") {
    if (startEl) startEl.value = plan.start;
    if (endEl) endEl.value = plan.end;
  }
  // 리밸런싱·적립: 문장에 있으면 쓰고, 이전 문장이 정한 값은 문장에서 빠지면 기본으로 되돌린다
  if (p.rebalance) { state.rebalance = p.rebalance; nlUi.owned.rebal = true; }
  else if (nlUi.owned.rebal) { state.rebalance = "Q"; nlUi.owned.rebal = false; }
  if (p.dca) {
    state.dcaOn = true;
    state.monthlyAmount = Math.max(0, p.dca.monthly);
    state.withdrawMode = "none";
    nlUi.owned.dca = true;
  } else if (nlUi.owned.dca) { state.dcaOn = false; nlUi.owned.dca = false; }
  if (p.initialCapital) state.initialCapital = Math.max(1, p.initialCapital);
  syncControlsFromState();
  const momOn = ["MOM", "DMOM", "MOM12_1", "XSMOM"].includes(state.rebalance);
  const momRow = document.getElementById("momControls");
  if (momRow) momRow.style.display = momOn ? "flex" : "none";
  const momHint = document.getElementById("momHint");
  if (momHint) momHint.style.display = momOn ? "block" : "none";
  const wm = document.getElementById("withdrawMode");
  if (wm) wm.value = state.withdrawMode || "none";
  await ensurePrices(p.items.map((x) => x.code));
  renderList();
  updateSum();
  updateIrpWarn();
  await run(); // 공유 해시는 run 래퍼(nlSyncHash)가 해석된 비중으로 갱신
}

/** 가격 시뮬 실행이 끝날 때마다 주소 해시를 지금 보유·기간·설정으로 맞춘다(기존 encodeShareParams).
 * 배당 탭이 열려 있거나 배당 해시(#div…)면 건드리지 않는다. */
function nlSyncHash() {
  try {
    if (!state.lastRun || typeof history === "undefined" || !history.replaceState) return;
    const pl = document.getElementById("priceLayout");
    if (pl && pl.hidden) return;
    if (typeof divDecodeHash === "function" && divDecodeHash(location.hash)) return;
    const q = encodeShareParams();
    if (`#${q}` !== location.hash) history.replaceState(null, "", `#${q}`);
  } catch (_) { /* 표시만 */ }
}

async function nlSubmit(text) {
  if (nlUi.busy) return null;
  const inp = document.getElementById("nlInput");
  const raw = text != null ? text : inp ? inp.value : "";
  if (!state.meta) { nlRender(`<div class="nl-hint">데이터를 불러오는 중입니다…</div>`); return null; }
  const p = NL.nlParse(raw, { etfs: state.meta.etfs, presets: PRESETS, dict: nlDict() });
  nlUi.last = p;
  if (p.mode === "rank") { nlRankClear(); await nlRankShow(p); return p; }
  nlRankClear();
  if (p.refuse) {
    nlRender(`<div class="nl-hint nl-refuse"><div>${nlEsc(NL.NL_REFUSE_MSG)}.</div><div>${nlEsc(NL.NL_REFUSE_RANK_MSG)} (예: 반도체 빼고 5년 수익률 높은 조합)</div></div>`);
    return p;
  }
  if (!p.ok) {
    if (p.errors.length) {
      let html = `<div class="nl-hint nl-err">${p.errors.map((e) => `<div>${nlEsc(e)}</div>`).join("")}<div>그래서 계산하지 않았어요.</div></div>`;
      if (p.unknown.length) html += `<div class="nl-line nl-unk">이해하지 못한 말: ${p.unknown.map((u) => `「${nlEsc(u)}」`).join(" ")}</div>`;
      nlRender(html);
    } else {
      const unk = p.unknown.length ? `이해하지 못한 말: ${p.unknown.map((u) => `「${u}」`).join(" ")}. ` : "";
      nlRender(nlHintHtml(`${unk}종목 이름(나스닥, 코스피, 금, 반도체…)이나 6자리 코드, 프리셋 이름(K-올웨더 등)을 적어 주세요.`));
    }
    return p;
  }
  nlRender(`<div class="nl-hint">계산 중…</div>`);
  nlUi.busy = true;
  try {
    await nlApply(p);
  } finally {
    nlUi.busy = false;
  }
  nlRenderInterp(p);
  return p;
}

// ---------- 격자 순위 검색 화면 ----------
async function nlRankData() {
  if (nlUi.deep) return nlUi.deep;
  const res = await fetch("./data/rank_deep_nl3.json?v=nl4");
  if (!res.ok) throw new Error(String(res.status));
  nlUi.deep = await res.json();
  return nlUi.deep;
}

function nlRankClear() {
  const box = document.getElementById("nlRank");
  if (box) box.innerHTML = "";
}

function nlRankSpecLine(R) {
  return `기간 ${R.periodLabel}${R.periodDefault ? "(기본)" : ""} · ${R.capLabel} · 격자 3종목 · 종목당≤50% · 5%단위 · 분기리밸 · 10bp · 일시불입`;
}

async function nlRankShow(p) {
  const R = p.rank;
  const box = document.getElementById("nlRank");
  nlRender("");
  let html = `<div class="nl-interp"><span class="nl-head">격자 순위로 이해했어요:</span> ${nlEsc(nlRankSpecLine(R))}</div>`;
  const tail = () => {
    let h = "";
    for (const n of p.notes) h += `<div class="nl-line nl-warn">· ${nlEsc(n)}</div>`;
    if (p.unknown.length) h += `<div class="nl-line nl-unk">이해하지 못한 말: ${p.unknown.map((u) => `「${nlEsc(u)}」`).join(" ")}</div>`;
    return h;
  };
  if (!p.ok) {
    html = `<div class="nl-interp"><span class="nl-head">격자 순위 조건을 읽지 못했어요:</span></div>`;
    html += `<div class="nl-hint nl-err">${p.errors.map((e) => `<div>${nlEsc(e)}</div>`).join("")}<div>그래서 순위를 보여 주지 않았어요.</div></div>` + tail();
    if (box) box.innerHTML = html;
    return;
  }
  let data;
  try {
    data = await nlRankData();
  } catch (_) {
    if (box) box.innerHTML = html + `<div class="nl-hint nl-err">격자 파일을 불러오지 못했습니다.</div>`;
    return;
  }
  const f = NL.nlRankFilter(R, data, nlDict());
  if (f.error) { if (box) box.innerHTML = html + `<div class="nl-hint nl-err">${nlEsc(f.error)}</div>`; return; }
  const nameOf = (c) => ((etfByCode(c) || {}).name || "");
  html += `<div class="nl-line">풀: 이 기간 시총 상위 ${f.poolN}종만(199종 전체 아님 · 레버리지·인버스 없음 · 같은 지수는 하나 · 기간 전체 시세 있는 종목) · 창 ${f.start}~${f.end} · ${f.days}거래일</div>`;
  if (R.excl.length) {
    for (const x of R.excl) {
      const inPool = x.codes.filter((c) => f.pool.includes(c));
      html += `<div class="nl-line nl-excl">제외(${nlEsc(x.label)}) ${x.codes.length}종목(${nlEsc(x.codes.join("·"))})` +
        ` → 이 기간 풀에서 ${inPool.length}종 빠짐${inPool.length ? `(${inPool.map((c) => nlEsc(`${c} ${nameOf(c)}`)).join(" · ")})` : " — 풀에 해당 종목 없음"}</div>`;
    }
  }
  html += `<div class="nl-line"><b>남은 조합 ${f.n}</b>(한도 안 3종 조합 ${f.totalN}개 중)${f.n === 0 ? " · 빈 목록" : f.n < 10 ? ` · 상위 ${f.n}만` : " · 상위 10"}</div>`;
  html += tail();
  html += `<details class="nl-pool"><summary>풀 ${f.poolN}종 보기</summary><div class="nl-line">${f.pool.map((c, i) => nlEsc(`${c} ${f.poolNames[i]}`)).join(" · ")}</div></details>`;
  html += `<div class="section-title nl-rank-title">이 격자·기간 안에서 높았던 조합 (과거 기준)</div>`;
  if (!f.rows.length) {
    html += `<div class="nl-hint">조건에 맞는 조합이 0개입니다. 조건을 바꿔 다시 적어 주세요.</div>`;
  } else {
    html += `<div class="rank-scroll"><table class="rank-table nl-rank-table"><thead><tr><th>#</th><th>구성</th><th class="num">CAGR%</th><th class="num">누적%</th><th class="num">MDD%</th><th>시작</th><th>종료</th><th class="num">거래일</th></tr></thead><tbody>` +
      f.rows.map((r, i) => `<tr class="rank-row nl-rank-row" data-i="${i}" tabindex="0" role="button"><td>${i + 1}</td><td class="rank-compose">${nlEsc(rankCompose(r))}<div class="nl-rank-mob">CAGR ${rankPct(r.cagr)}% · MDD ${rankPct(r.mdd)}% · 누적 ${rankPct(r.total)}%</div></td><td class="num">${rankPct(r.cagr)}</td><td class="num">${rankPct(r.total)}</td><td class="num">${rankPct(r.mdd)}</td><td class="num">${f.start}</td><td class="num">${f.end}</td><td class="num">${f.days}</td></tr>`).join("") +
      `</tbody></table></div>`;
    html += `<p class="muted-note">행을 누르면 그 종목·비중을 불러 표의 시작·종료(직접 지정)로 기존 백테스트를 실행합니다. 표 숫자는 분기리밸·10bp·일시불입 기준이고, 실행은 「고급 설정」 값을 그대로 씁니다. 과거 시뮬 · 투자 자문 아님.</p>`;
  }
  if (box) box.innerHTML = html;
  nlUi.rankLast = { p, f };
  document.querySelectorAll("#nlRank .nl-rank-row").forEach((tr) => {
    const go = () => nlRankApply(Number(tr.dataset.i));
    tr.onclick = go;
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
}

async function nlRankApply(i) {
  const L = nlUi.rankLast;
  const row = L && L.f.rows[i];
  if (!row) return;
  document.querySelectorAll("#nlRank .nl-rank-row").forEach((tr) => tr.classList.toggle("active", Number(tr.dataset.i) === i));
  if (typeof rankUi !== "undefined") rankUi.pick = null;
  document.querySelectorAll("#presets .chip").forEach((el) => el.classList.remove("active"));
  state.activePreset = null;
  // 이전 문장이 정한 리밸런싱·적립은 기본으로 (격자 표 가정과 맞춤)
  if (nlUi.owned.rebal) { state.rebalance = "Q"; nlUi.owned.rebal = false; }
  if (nlUi.owned.dca) { state.dcaOn = false; nlUi.owned.dca = false; }
  state.period = "custom";
  const st = document.getElementById("startDate"), en = document.getElementById("endDate");
  if (st) st.value = L.f.start;
  if (en) en.value = L.f.end;
  state.selected = {};
  await ensurePrices(row.tickers);
  row.tickers.forEach((c, k) => { if (state.meta.etfs.some((e) => e.code === c)) state.selected[c] = row.weights[k]; });
  syncControlsFromState();
  renderList();
  updateSum();
  updateIrpWarn();
  await run();
  const res = document.getElementById("result");
  if (res && res.scrollIntoView) res.scrollIntoView({ block: "start" });
}

/** 현재 state → 다시 넣으면 같은 해석이 되는 문장 (공유 링크로 열었을 때 입력칸에 채움) */
function nlSentenceFromState() {
  const parts = [];
  const sel = Object.entries(state.selected).filter(([, w]) => w > 0);
  const pk = state.activePreset;
  const presetMatch = pk && PRESETS[pk] && Object.keys(PRESETS[pk].w).length === sel.length &&
    sel.every(([c, w]) => Math.abs((PRESETS[pk].w[c] || 0) - w) < 1e-6);
  if (presetMatch) {
    const lab = String(PRESETS[pk].label || "").replace(/^[^\uac00-\ud7a3A-Za-z0-9]+/, "").trim();
    parts.push(pk === "usDivDowKR" ? "미국배당다우존스 프리셋" : lab);
  } else {
    for (const [c, w] of sel) parts.push(`${c} ${NL.fmtW(w)}`);
  }
  const per = state.period;
  if (per === "custom") {
    const s = document.getElementById("startDate")?.value, e = document.getElementById("endDate")?.value;
    parts.push(s && e ? `${s}~${e}` : "최장");
  } else parts.push({ "1y": "1년", "3y": "3년", "5y": "5년", "10y": "10년", max: "최장" }[per] || "최장");
  if (state.rebalance === "Y") parts.push("연 리밸");
  else if (state.rebalance === "M") parts.push("매월 리밸");
  else if (state.rebalance === "N") parts.push("리밸 없음");
  if (state.dcaOn) parts.push(`매월 ${Math.round(state.monthlyAmount / 10000)}만원 적립`);
  return parts.join(" ");
}

/** 쉬운 입력 밖(첫 화면·공유 링크·프리셋 칩·고급 설정 실행·격자 행)에서 run()이 끝나면
 * 입력칸과 해석 줄을 지금 결과에 맞춘다. */
function nlAfterBoot(opts = {}) {
  const inp = document.getElementById("nlInput");
  if (!inp || !state.meta || !state.lastRun) return;
  const fromShare = !!opts.initial && nlUi.bootFromShare;
  nlUi.owned = { rebal: false, dca: false };
  if (["Y", "M", "N"].includes(state.rebalance)) nlUi.owned.rebal = !!fromShare;
  if (state.dcaOn) nlUi.owned.dca = !!fromShare;
  const s = nlSentenceFromState();
  inp.value = s;
  const p = NL.nlParse(s, { etfs: state.meta.etfs, presets: PRESETS, dict: nlDict() });
  if (p.ok) {
    // 화면의 실제 비중(state)을 그대로 보여 준다
    p.items = Object.entries(state.selected).filter(([, w]) => w > 0).map(([c, w]) => ({ code: c, name: (etfByCode(c) || {}).name || "", weight: w }));
    p.alts = [];
    nlRenderInterp(p, { prefix: fromShare ? "링크로 연 설정" : "지금 결과" });
  }
}

function nlWire() {
  const inp = document.getElementById("nlInput");
  const btn = document.getElementById("nlRun");
  if (!inp || !btn) return;
  btn.onclick = () => nlSubmit();
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); nlSubmit(); }
  });
  const ex = document.getElementById("nlExamples");
  if (ex) {
    ex.innerHTML = "";
    for (const s of NL.NL_EXAMPLES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip nl-ex";
      b.textContent = s;
      b.onclick = () => { inp.value = s; nlSubmit(s); };
      ex.appendChild(b);
    }
  }
  const adv = document.getElementById("advSettings");
  const lay = document.getElementById("priceLayout");
  const syncAdv = () => { if (lay && adv) lay.classList.toggle("adv-closed", !adv.open); };
  if (adv) { adv.addEventListener("toggle", syncAdv); syncAdv(); }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlWire);
}

// 첫 화면이 공유 링크로 열렸는지는 로드 시점 해시로만 판단(실행 후 해시는 nlSyncHash가 다시 쓴다)
try {
  const sh = typeof parseShareHash === "function" ? parseShareHash() : null;
  nlUi.bootFromShare = !!(sh && (sh.get("preset") || sh.get("h")));
} catch (_) {
  nlUi.bootFromShare = false;
}

// 기존 run()을 감싼다(계산은 그대로). 쉬운 입력 밖에서 실행된 결과도 해석 줄에 반영.
(function nlHookRun() {
  if (typeof run !== "function" || run.__nlWrapped) return;
  const origRun = run;
  const wrapped = async function () {
    const r = await origRun.apply(this, arguments);
    nlSyncHash();
    if (!nlUi.busy) {
      try {
        nlAfterBoot({ initial: !nlUi.booted });
      } catch (_) { /* 표시만 */ }
      nlUi.booted = true;
    }
    return r;
  };
  wrapped.__nlWrapped = true;
  run = wrapped; // eslint-disable-line no-global-assign
})();
