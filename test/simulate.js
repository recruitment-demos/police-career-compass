/* ---------------------------------------------------------------------------
   test/simulate.js — סימולציית התפלגות על פרופילים אקראיים.

   הרצה:  node test/simulate.js [מספר_פרופילים]

   הבדיקות ב-run_checks.js מוודאות נכונות נקודתית; הקובץ הזה בודק את
   ההתנהגות המצרפית — האם המדיניות שהוגדרה אכן מתקיימת על פני אוכלוסייה:

     • רוב ההמלצות הן תפקידי ליבה.
     • בתוך הליבה, 80–90% הן חוקר / בלש / סייר.
     • משל"ט מופיע הרבה.
     • מי שאין לו אינדיקציה לליבה מנותב למנהלה.

   ההגרלה אינה אחידה לגמרי: היא משקללת את האפשרויות כך שיתקבלו פרופילים
   סבירים ולא רק קצוות. זו סימולציה של התפלגות, לא הוכחה פורמלית.
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

const N = parseInt(process.argv[2], 10) || 4000;
const PRIMARY = ["patrol", "detective", "investigator"];

// מחולל אקראי עם זרע קבוע, כדי שהרצה חוזרת תיתן אותה תוצאה.
let seed = 20260728;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

/** בונה פרופיל אקראי, תוך כיבוד השאלות המותנות. */
function randomAnswers() {
  const answers = {};
  // נבנה שלב אחר שלב: אחרי כל תשובה מחושב מחדש אילו שאלות רלוונטיות.
  for (let guard = 0; guard < 40; guard++) {
    const visible = visibleQuestions(answers);
    const next = visible.find(q => answers[q.id] == null);
    if (!next) break;

    if (next.multi && rnd() < 0.35) {
      // לפעמים בוחרים שתי אפשרויות, כדי לתרגל את הבחירה המרובה.
      const a = pick(next.options), b = pick(next.options);
      answers[next.id] = a.id === b.id ? [a.id] : [a.id, b.id];
    } else {
      answers[next.id] = [pick(next.options).id];
    }
  }
  return answers;
}

const roleById = {};
ROLES.forEach(r => { roleById[r.id] = r; });

const counts = {};
let coreSlots = 0, primarySlots = 0, adminTrack = 0, coreTrack = 0;
let dispatcherAppears = 0, tooFewCore = 0, emptyResults = 0;
let exactFitProfiles = 0, exactFitNotFirst = 0, exactFitBelowFloor = 0, noPrimaryCore = 0;

for (let i = 0; i < N; i++) {
  const res = computeResults(randomAnswers());
  if (res.top3.length !== 3) emptyResults++;
  if (res.track === "admin") adminTrack++; else coreTrack++;

  let coreInThis = 0, primaryInThis = 0;
  res.top3.forEach(e => {
    counts[e.id] = (counts[e.id] || 0) + 1;
    const track = roleById[e.id].track;
    if (track === "core") {
      coreSlots++; coreInThis++;
      if (PRIMARY.indexOf(e.id) !== -1) { primarySlots++; primaryInThis++; }
    }
  });
  if (res.top3.some(e => e.id === "dispatcher")) dispatcherAppears++;

  // התאמת כפפה: כשהיא קיימת היא חייבת להיות ראשונה ומעל רצפת האחוזים.
  const exact = res.top3.filter(e => e.exactFit);
  if (exact.length > 0) {
    exactFitProfiles++;
    if (res.top3[0].exactFit !== true) exactFitNotFirst++;
    if (exact.some(e => e.matchPct < CONFIG.EXACT_FIT_MIN_PCT)) exactFitBelowFloor++;
  }

  // הכפפה לוקחת אחת משתי משבצות הליבה השמורות, ולכן במסלול ליבה הדרישה
  // היא שתי משבצות ליבה — או אחת כשהכפפה לקחה את השנייה. מה שלא נסוג
  // בשום מצב הוא ההבטחה לתפקיד ליבה *ראשי* אחד לפחות.
  if (res.track === "core") {
    if (coreInThis < (exact.length > 0 ? 1 : 2)) tooFewCore++;
    if (primaryInThis < 1) noPrimaryCore++;
  }
}

const pct = (a, b) => b === 0 ? "0.0" : (a / b * 100).toFixed(1);

console.log("סימולציה על " + N + " פרופילים אקראיים\n");
console.log("מסלול ליבה:   " + coreTrack + "  (" + pct(coreTrack, N) + "%)");
console.log("מסלול מנהלה:  " + adminTrack + "  (" + pct(adminTrack, N) + "%)");
console.log("");
console.log("סה\"כ משבצות:            " + (N * 3));
console.log("מתוכן תפקידי ליבה:      " + coreSlots + "  (" + pct(coreSlots, N * 3) + "%)");
console.log("מתוך הליבה — חוקר/בלש/סייר: " + primarySlots + "  (" + pct(primarySlots, coreSlots) + "%)  ← יעד 80–90%");
console.log("פרופילים שבהם הופיע משל\"ט:  " + dispatcherAppears + "  (" + pct(dispatcherAppears, N) + "%)");
console.log("");

console.log("התפלגות ההמלצות:");
Object.keys(counts)
  .sort((a, b) => counts[b] - counts[a])
  .forEach(id => {
    const r = roleById[id];
    const bar = "█".repeat(Math.max(1, Math.round(counts[id] / N * 60)));
    console.log(
      "  " + String(pct(counts[id], N)).padStart(5) + "%  " +
      bar.padEnd(22) + " " + r.name +
      (r.track === "core" ? "  [ליבה]" : r.track === "admin" ? "  [מנהלה]" : "")
    );
  });

console.log("");
let problems = 0;
const assert = (name, ok, detail) => {
  console.log((ok ? "[32m✓[0m " : "[31m✗[0m ") + name + (detail ? "  [90m— " + detail + "[0m" : ""));
  if (!ok) problems++;
};

const primaryShare = coreSlots === 0 ? 0 : primarySlots / coreSlots * 100;
assert("בתוך הליבה, 80–90% הם חוקר/בלש/סייר", primaryShare >= 80 && primaryShare <= 90,
       primaryShare.toFixed(1) + "%");
assert("רוב המשבצות הן תפקידי ליבה", coreSlots / (N * 3) > 0.5, pct(coreSlots, N * 3) + "%");
assert("משל\"ט מופיע בלפחות 15% מהפרופילים", dispatcherAppears / N >= 0.15,
       pct(dispatcherAppears, N) + "%");
assert("כל פרופיל קיבל 3 המלצות", emptyResults === 0, emptyResults + " חריגים");
assert("במסלול ליבה — 2 תפקידי ליבה, או 1 כשהכפפה לקחה משבצת",
       tooFewCore === 0, tooFewCore + " חריגים");
assert("במסלול ליבה תמיד לפחות תפקיד ליבה ראשי אחד",
       noPrimaryCore === 0, noPrimaryCore + " חריגים");
assert("התאמת כפפה מופיעה תמיד ראשונה", exactFitNotFirst === 0,
       exactFitProfiles + " פרופילים עם כפפה, " + exactFitNotFirst + " חריגים");
assert("התאמת כפפה תמיד מעל רצפת האחוזים", exactFitBelowFloor === 0,
       exactFitBelowFloor + " חריגים");

console.log("");
if (problems === 0) {
  console.log("[32mההתפלגות עומדת ביעדים.[0m");
} else {
  console.log("[31m" + problems + " יעדים לא התקיימו.[0m");
  process.exit(1);
}
