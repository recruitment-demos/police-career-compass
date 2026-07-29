/* ---------------------------------------------------------------------------
   tools/role_stats.js — מחשב לכל תפקיד את הסיכוי להיות מומלץ, ומה מאפיין אותו.

   הרצה:  node tools/role_stats.js [מספר_פרופילים] > tools/role_stats.json

   הסיכוי נמדד בסימולציה על פרופילים אקראיים — אותו מחולל ואותו זרע כמו
   test/simulate.js, כדי ששתי התוצאות ידברו על אותה אוכלוסייה. זה **אינו**
   הסיכוי להתקבל לתפקיד בפועל: זה הסיכוי שהכלי יציע אותו למועמד אקראי.

   המאפיינים אינם ניסוח חופשי — הם נגזרים ישירות ממטריצת הניקוד: אילו
   תשובות בשאלון תורמות לתפקיד הזה הכי הרבה נקודות.
   --------------------------------------------------------------------------- */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const sandbox = { console, module: undefined };
vm.createContext(sandbox);
["data/config.js", "data/roles.js", "data/questions.js", "scoring.js"].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), sandbox, { filename: f });
});

const QUESTIONS = vm.runInContext("QUESTIONS", sandbox);
const ROLES = vm.runInContext("ROLES", sandbox);
const CONFIG = vm.runInContext("CONFIG", sandbox);
const computeResults = vm.runInContext("computeResults", sandbox);
const visibleQuestions = vm.runInContext("visibleQuestions", sandbox);
const computeMaxScores = vm.runInContext("computeMaxScores", sandbox);

const N = parseInt(process.argv[2], 10) || 4000;

// אותו מחולל ואותו זרע כמו test/simulate.js.
let seed = 20260728;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }

function randomAnswers() {
  const answers = {};
  for (let guard = 0; guard < 40; guard++) {
    const visible = visibleQuestions(answers);
    const next = visible.find(q => answers[q.id] == null);
    if (!next) break;
    if (next.multi && rnd() < 0.35) {
      const a = pick(next.options), b = pick(next.options);
      answers[next.id] = a.id === b.id ? [a.id] : [a.id, b.id];
    } else {
      answers[next.id] = [pick(next.options).id];
    }
  }
  return answers;
}

// ── הסימולציה ──────────────────────────────────────────────────────────────
const inTop3 = {}, atFirst = {}, pctSum = {}, blocked = {};
ROLES.forEach(r => { inTop3[r.id] = 0; atFirst[r.id] = 0; pctSum[r.id] = 0; blocked[r.id] = 0; });

for (let i = 0; i < N; i++) {
  const res = computeResults(randomAnswers());
  res.top3.forEach((e, idx) => {
    inTop3[e.id]++;
    pctSum[e.id] += e.matchPct;
    if (idx === 0) atFirst[e.id]++;
  });
  res.all.forEach(e => { if (!e.passedGates) blocked[e.id]++; });
}

// ── מה מאפיין כל תפקיד — נגזר ממטריצת הניקוד ───────────────────────────────
/** התשובות שתורמות לתפקיד הכי הרבה נקודות, ממוינות מלמעלה. */
function drivers(roleId, limit) {
  const rows = [];
  QUESTIONS.forEach(q => {
    q.options.forEach(o => {
      const pts = (o.scores || {})[roleId];
      if (pts > 0) rows.push({ q: q.text, option: o.label, pts: pts });
    });
  });
  rows.sort((a, b) => b.pts - a.pts);
  return rows.slice(0, limit || 6);
}

/** תיאור קריא של תנאי-הסף של התפקיד. */
function gateText(role) {
  const g = role.gates || {};
  const parts = [];
  const fieldName = id => {
    const q = QUESTIONS.filter(x => x.id === "degree_field")[0];
    const o = q && q.options.filter(x => x.id === id)[0];
    return o ? o.label : id;
  };
  if (g.minRifleman != null) parts.push("רובאי " + String(g.minRifleman).padStart(2, "0") + " ומעלה");
  if (g.requiresCombat) parts.push("רקע לחימה");
  if (g.requiresCombatCommand) parts.push("רקע קרבי-פיקודי");
  if (g.requiresDegree) parts.push("תואר אקדמי");
  if (g.minResilience != null) parts.push("חוסן נפשי מול מראות קשים");
  if (g.minArabic != null) parts.push("שליטה בערבית");
  if (g.requiresStudent) parts.push("סטודנט/ית");
  if (g.requiresStudyYear) parts.push("יתרת לימודים של שנה לפחות");
  if (g.requiresExOfficer) parts.push("רקע קצונה");
  if (Array.isArray(g.requiresFieldMatch)) {
    parts.push("רקע אקדמי ב: " + g.requiresFieldMatch.map(fieldName).join(" / "));
  }
  if (g.requiresVocational) parts.push("הכשרה מקצועית ב" + g.requiresVocational + " — אינה נשאלת בשאלון");
  return parts.length ? parts.join(" · ") : "ללא תנאי סף";
}

const trackName = { core: "ליבה", specialist: "התמחות", admin: "מנהלה" };
const fullMax = computeMaxScores(QUESTIONS);

const out = ROLES.map(role => ({
  id: role.id,
  name: role.name,
  category: role.category,
  track: trackName[role.track] || role.track,
  tier: role.coreTier === "primary" ? "ליבה ראשית"
      : role.coreTier === "secondary" ? "ליבה משנית"
      : role.adminTier === "central" ? "מנהלה מרכזית"
      : role.adminTier === "professional" ? "מנהלה מקצועית"
      : "",
  pctTop3: +(inTop3[role.id] / N * 100).toFixed(1),
  pctFirst: +(atFirst[role.id] / N * 100).toFixed(1),
  avgMatch: inTop3[role.id] ? Math.round(pctSum[role.id] / inTop3[role.id]) : null,
  pctBlocked: +(blocked[role.id] / N * 100).toFixed(1),
  maxScore: fullMax[role.id] || 0,
  oneLiner: role.oneLiner,
  dayInLife: role.dayInLife,
  drivers: drivers(role.id),
  gates: gateText(role),
  requirements: role.requirements || [],
  training: role.training,
  salary: role.salary,
  advancement: role.advancement,
  source: role.source === "kb" ? "מאגר מרכז הגיוס" : "דף התפקידים הרשמי",
  salaryShown: role.salary || CONFIG.SALARY_UNKNOWN
}));

process.stdout.write(JSON.stringify({ n: N, roles: out }, null, 1));
