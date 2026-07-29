/* ---------------------------------------------------------------------------
   test/run_checks.js — מריץ את בדיקות השפיות של §5.7 מחוץ לדפדפן.

   הרצה:  node test/run_checks.js
   יוצא בקוד 1 אם בדיקה כלשהי נכשלה, כדי שאפשר יהיה לחבר את זה ל-CI.

   הקבצים באפליקציה הם <script> רגילים ולא מודולים (כדי לעבוד ב-file://),
   ולכן כאן טוענים אותם לתוך קונטקסט vm אחד — בדיוק כמו שהדפדפן עושה.
   --------------------------------------------------------------------------- */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const files = [
  "data/config.js",
  "data/roles.js",
  "data/questions.js",
  "scoring.js"
];

const sandbox = { console, module: undefined };
vm.createContext(sandbox);

files.forEach(file => {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(code, sandbox, { filename: file });
});

const results = vm.runInContext("runSanityChecks()", sandbox);
const failed = results.filter(r => !r.passed);

results.forEach(r => {
  const mark = r.passed ? "[32m✓[0m" : "[31m✗[0m";
  console.log(mark + " " + r.name + (r.detail ? "  [90m— " + r.detail + "[0m" : ""));
});

console.log("");
if (failed.length === 0) {
  console.log("[32mכל " + results.length + " הבדיקות עברו.[0m");
} else {
  console.log("[31m" + failed.length + " מתוך " + results.length + " בדיקות נכשלו.[0m");
  process.exit(1);
}
