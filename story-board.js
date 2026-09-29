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
