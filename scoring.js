/* ---------------------------------------------------------------------------
   scoring.js — מנוע הניקוד הדטרמיניסטי.

   כל הפונקציות כאן טהורות: הן מקבלות תשובות ומחזירות תוצאה, ואינן נוגעות ב-DOM.
   זו הסיבה שאפשר להריץ אותן בבדיקות (test/) בלי דפדפן.

   מבנה התשובות: { questionId: [optionId, ...] } — תמיד מערך, גם בשאלת
   בחירה יחידה, כדי שיהיה מסלול קוד אחד בלבד (תיקון 1: בחירה מרובה).

   הזרימה:
     answers → profile → שאלות רלוונטיות → earned/maxScore → gates
             → אחוזים → ניתוב מסלול (ליבה / מנהלה) → top3 + blocked + נימוקים
   --------------------------------------------------------------------------- */

// ── עזרים ──────────────────────────────────────────────────────────────────

function getRole(roleId) {
  return ROLES.find(r => r.id === roleId) || null;
}

function getQuestion(questionId) {
  return QUESTIONS.find(q => q.id === questionId) || null;
}

/** מנרמל תשובה לצורת מערך. תומך גם במחרוזת בודדת, למקרה של קלט ישן. */
function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

/** האופציות שנבחרו בשאלה מסוימת. מערך ריק אם לא נענתה. */
function getSelectedOptions(question, answers) {
  const ids = toArray(answers[question.id]);
  return ids
    .map(id => question.options.find(o => o.id === id))
    .filter(Boolean);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// ── בניית פרופיל ───────────────────────────────────────────────────────────

/**
 * ממזג את שדות ה-profile של כל האופציות שנבחרו.
 *
 * דגלים בוליאניים (isStudent, hasDegree, combatCommand…) הם OR: מספיק
 * שאופציה אחת סימנה true. זה מה שמאפשר למועמד להשתייך לכמה קבוצות בו-זמנית
 * — סטודנט שהוא גם קצין לשעבר יקבל את שני הדגלים ואת שני המסלולים.
 *
 * הפונקציה חייבת להיות בטוחה להרצה על תשובות חלקיות, כי היא נקראת גם
 * באמצע השאלון כדי להחליט אילו שאלות מותנות להציג.
 */
function buildProfile(answers) {
  const profile = {};
  const OR_FLAGS = ["hasDegree", "isStudent", "isGraduate", "isCivilian",
                    "isExOfficer", "combatCommand", "studyYear", "arabicRefuses",
                    "wantsField", "wantsOffice", "wantsLab", "wantsControl",
                    "investigative"];

  QUESTIONS.forEach(question => {
    getSelectedOptions(question, answers).forEach(option => {
      if (!option.profile) return;
      Object.keys(option.profile).forEach(key => {
        const value = option.profile[key];
        if (OR_FLAGS.indexOf(key) !== -1) {
          profile[key] = profile[key] === true || value === true;
        } else {
          profile[key] = value;
        }
      });
    });
  });

  // ברירות מחדל למי שלא הגיע לשאלה או לא ענה עליה.
  if (profile.resilience   == null) profile.resilience   = 2;
  if (profile.arabic       == null) profile.arabic       = 0;
  if (profile.rifleman     == null) profile.rifleman     = 2;
  if (profile.techAffinity == null) profile.techAffinity = 1;
  if (profile.fitness      == null) profile.fitness      = 1;
  if (profile.risk         == null) profile.risk         = 1;
  if (profile.hasDegree    == null) profile.hasDegree    = false;

  // combat נגזר מרמת הרובאי, לא נשאל ישירות.
  profile.combat = profile.rifleman >= 3;
  profile.combatCommand = profile.combatCommand === true;

  return profile;
}

// ── שאלות רלוונטיות (showIf) ───────────────────────────────────────────────

/**
 * השאלות שצריכות להיות מוצגות בהינתן התשובות עד כה.
 * שאלה בלי showIf מוצגת תמיד. שאלה מותנית נבדקת מול הפרופיל הנוכחי,
 * כך שסימון "יש לי תואר" פותח מיד את שאלת תחום הלימודים.
 */
function visibleQuestions(answers) {
  const profile = buildProfile(answers);
  return QUESTIONS.filter(q => typeof q.showIf !== "function" || q.showIf(profile) === true);
}

// ── ניקוד גולמי ────────────────────────────────────────────────────────────

/**
 * סוכם לכל תפקיד את הנקודות שהתשובות תרמו לו.
 *
 * בשאלת בחירה מרובה נלקחת התרומה הגבוהה ביותר מבין האופציות שנבחרו — ולא
 * סכום שלהן. אחרת סימון של כמה אפשרויות היה מנפח את הניקוד באופן מלאכותי
 * ופוגע בהשוואה בין מועמדים. "מקסימום" מבטא את ההתאמה הטובה ביותר שהמועמד
 * סימן, וזה גם מה שמייצר מכנה עקבי ב-computeMaxScores.
 */
function computeEarned(answers, questions) {
  const list = questions || visibleQuestions(answers);
  const earned = {};
  ROLES.forEach(role => { earned[role.id] = 0; });

  list.forEach(question => {
    const best = {};
    getSelectedOptions(question, answers).forEach(option => {
      Object.keys(option.scores || {}).forEach(roleId => {
        const pts = option.scores[roleId];
        if (pts <= 0) return;
        if (best[roleId] == null || pts > best[roleId]) best[roleId] = pts;
      });
    });
    Object.keys(best).forEach(roleId => {
      if (earned[roleId] == null) return; // roleId לא מוכר — נתפס בבדיקות
      earned[roleId] += best[roleId];
    });
  });

  return earned;
}

/**
 * לכל תפקיד: בכמה שאלות *שונות* התשובות תרמו לו נקודה כלשהי.
 *
 * זה מדד רוחב הראיות, ולא עוצמתן. אחוז ההתאמה הוא ניקוד מנורמל, ולכן תפקיד
 * שרק שלוש-ארבע שאלות נוגעות בו מגיע ל-100% בקלות רבה יותר מתפקיד ששתים-עשרה
 * שאלות נוגעות בו — אותו אחוז, בסיס ראייתי שונה לגמרי. הספירה הזו מאפשרת
 * להבדיל ביניהם בלי לשנות את הניקוד עצמו.
 */
function computeEvidence(answers, questions) {
  const list = questions || visibleQuestions(answers);
  const evidence = {};
  ROLES.forEach(role => { evidence[role.id] = 0; });

  list.forEach(question => {
    const touched = {};
    getSelectedOptions(question, answers).forEach(option => {
      Object.keys(option.scores || {}).forEach(roleId => {
        if (option.scores[roleId] > 0) touched[roleId] = true;
      });
    });
    Object.keys(touched).forEach(roleId => {
      if (evidence[roleId] == null) return;
      evidence[roleId] += 1;
    });
  });

  return evidence;
}

// ── ניקוד מרבי לנרמול ──────────────────────────────────────────────────────

/**
 * לכל תפקיד: סכום התרומה המקסימלית מכל שאלה שהוצגה בפועל.
 *
 * חשוב שהמכנה יחושב על אותן שאלות שהמשתמש ראה. שאלה מותנית שלא הוצגה
 * (למשל תחום התואר, למי שאין תואר) לא נספרת — אחרת היא הייתה מענישה
 * את התפקידים שתלויים בה מבלי שלמשתמש הייתה הזדמנות לענות עליה.
 */
function computeMaxScores(questions) {
  const list = questions || QUESTIONS;
  const maxScore = {};
  ROLES.forEach(role => { maxScore[role.id] = 0; });

  list.forEach(question => {
    const bestInQuestion = {};
    question.options.forEach(option => {
      Object.keys(option.scores || {}).forEach(roleId => {
        const pts = option.scores[roleId];
        if (pts <= 0) return;
        if (bestInQuestion[roleId] == null || pts > bestInQuestion[roleId]) {
          bestInQuestion[roleId] = pts;
        }
      });
    });
    Object.keys(bestInQuestion).forEach(roleId => {
      if (maxScore[roleId] == null) return;
      maxScore[roleId] += bestInQuestion[roleId];
    });
  });

  return maxScore;
}

// ── תנאי-סף ────────────────────────────────────────────────────────────────

/**
 * התווית של תחום לימודים, נשלפת מהשאלון עצמו כדי שלא תיווצר רשימה מקבילה
 * שתצא מסנכרון. אם המזהה לא נמצא — מוחזר המזהה עצמו.
 */
function fieldLabel(fieldId) {
  const question = QUESTIONS.filter(q => q.id === "degree_field")[0];
  const option = question && question.options.filter(o => o.id === fieldId)[0];
  return option ? option.label : fieldId;
}

/**
 * מחזיר { passed, unmet }. gates ריק = תמיד עובר, ולכן תפקידי הליבה
 * ותפקידי המנהלה המרכזיים לעולם לא נחסמים ותמיד יש ממה להשלים 3 המלצות.
 */
function checkGates(role, profile) {
  const gates = role.gates || {};
  const unmet = [];

  if (gates.minRifleman != null && !(profile.rifleman >= gates.minRifleman)) {
    unmet.push({ gate: "minRifleman", need: gates.minRifleman, label: "דורש רובאי " + String(gates.minRifleman).padStart(2, "0") + " ומעלה" });
  }
  if (gates.requiresCombat === true && profile.combat !== true) {
    unmet.push({ gate: "requiresCombat", label: "דורש רקע לחימה" });
  }
  if (gates.requiresCombatCommand === true && profile.combatCommand !== true) {
    unmet.push({ gate: "requiresCombatCommand", label: "דורש רקע קרבי-פיקודי" });
  }
  if (gates.requiresDegree === true && profile.hasDegree !== true) {
    unmet.push({ gate: "requiresDegree", label: "דורש תואר אקדמי" });
  }
  if (gates.minResilience != null && !(profile.resilience >= gates.minResilience)) {
    unmet.push({ gate: "minResilience", need: gates.minResilience, label: "דורש חוסן נפשי מול מראות קשים" });
  }
  if (gates.minArabic != null && !(profile.arabic >= gates.minArabic)) {
    unmet.push({ gate: "minArabic", label: "דורש שליטה בערבית" });
  }
  if (gates.requiresStudent === true && profile.isStudent !== true) {
    unmet.push({ gate: "requiresStudent", label: "מיועד לסטודנטים בלבד" });
  }
  if (gates.requiresStudyYear === true && profile.studyYear !== true) {
    unmet.push({ gate: "requiresStudyYear", label: "דורש יתרת לימודים של שנה לפחות" });
  }
  if (gates.requiresExOfficer === true && profile.isExOfficer !== true) {
    unmet.push({ gate: "requiresExOfficer", label: "מיועד לבעלי רקע קצונה" });
  }

  // תפקיד שדרישותיו הן הסמכה בתחום מסוים — תואר במשפטים, מהנדס בניין,
  // תעודת חשבי שכר. בלי השער הזה הוא נבחר על סמך אותות גנריים בלבד (משרד,
  // שעות יום, מול עובדים) ויכול היה להגיע ל-100% אצל מי שאין לו שום זיקה
  // לתחום. הרשימה בכל תפקיד נגזרת מהדרישות שהתפקיד עצמו מפרסם.
  if (Array.isArray(gates.requiresFieldMatch)) {
    if (gates.requiresFieldMatch.indexOf(profile.degreeField) === -1) {
      unmet.push({
        gate: "requiresFieldMatch",
        need: gates.requiresFieldMatch,
        label: "דורש רקע אקדמי מתאים: " + gates.requiresFieldMatch.map(fieldLabel).join(" / ")
      });
    }
  }

  // תפקיד שההסמכה שלו כלל אינה נשאלת בשאלון — תואר בתזונה, רישיון רפואי.
  // אי אפשר לאשר אותו מהתשובות, ולכן הוא לא מומלץ; הוא נשאר בקטלוג ומוצג
  // בבלוק השקיפות עם הסיבה, במקום להופיע בהתאמה גבוהה בלי בסיס.
  if (gates.requiresVocational) {
    unmet.push({
      gate: "requiresVocational",
      need: gates.requiresVocational,
      label: "דורש הכשרה מקצועית ב" + gates.requiresVocational + " — לא נבדק בשאלון"
    });
  }

  // מסלול אולפן ערבית לא רלוונטי למי שסימן שאינו מעוניין ללמוד ערבית.
  if (role.id === "arabic_investigator" && profile.arabicRefuses === true) {
    unmet.push({ gate: "arabicRefuses", label: "סימנת שאינך מעוניין/ת ללמוד ערבית" });
  }

  return { passed: unmet.length === 0, unmet };
}

// ── התאמת כפפה ─────────────────────────────────────────────────────────────

/**
 * האם הרקע האקדמי של המועמד הוא בדיוק מה שהתפקיד דורש.
 *
 * `requiresFieldMatch` הוא השער היחיד שמבטא זהות מקצועית ולא נכונות כללית:
 * הוא נגזר מדרישה שהתפקיד עצמו מפרסם ("תואר ראשון בעבודה סוציאלית"), ומי
 * שעומד בו אינו סתם מתאים לתפקיד — הוא האדם שהתפקיד מחפש. שאר השערים
 * (רובאי, כושר, חוסן) הם תנאי כניסה שרבים עומדים בהם, ולכן אינם מזכים.
 *
 * הבדיקה נעשית על התחום בפועל ולא על מעבר השער בכללותו: תפקיד יכול לדרוש
 * גם תואר וגם תחום, ומי שעדיין לומד ייחסם — ובצדק — למרות התאמת התחום.
 * לכן מי שקורא לפונקציה חייב לוודא גם `passedGates`.
 */
function hasFieldMatch(role, profile) {
  const fields = (role.gates || {}).requiresFieldMatch;
  if (!Array.isArray(fields) || fields.length === 0) return false;
  return fields.indexOf(profile.degreeField) !== -1;
}

// ── נימוקים ────────────────────────────────────────────────────────────────

/** "למה זה מתאים לך" — נגזר אך ורק מהתשובות שנבחרו בפועל. */
function buildReasons(roleId, answers, limit) {
  const max = limit != null ? limit : CONFIG.MAX_REASONS;
  const contributions = [];

  visibleQuestions(answers).forEach(question => {
    getSelectedOptions(question, answers).forEach(option => {
      const pts = (option.scores || {})[roleId];
      if (!pts || pts <= 0) return;
      contributions.push({
        questionId: question.id,
        questionText: question.text,
        optionLabel: option.label,
        points: pts,
        text: 'בחרת: "' + option.label + '"'
      });
    });
  });

  contributions.sort((a, b) => b.points - a.points);
  return contributions.slice(0, max);
}

// ── ניתוב מסלול ────────────────────────────────────────────────────────────

/**
 * האם למועמד אין שום אינדיקציה לתפקיד ליבה.
 *
 * תפקיד ליבה מחייב שלושה דברים בסיסיים: נכונות למגע עם אזרחים, כשירות
 * גופנית כלשהי, ורובאי. מי שסימן שלילה בכל השלושה — אין טעם להציע לו סיור
 * או בילוש; הוא ינותב למנהלה. די באחד מהשלושה כדי להישאר במסלול הליבה,
 * כדי לא לנתב למנהלה מועמדים שרק מסויגים בנקודה אחת.
 */
function isAdminTrack(profile) {
  const noCitizens = profile.facing != null && profile.facing !== "citizens";
  const noFitness  = profile.fitness === 0;
  const noRifleman = profile.rifleman === 0;
  return noCitizens && noFitness && noRifleman;
}

function roleTrack(role) {
  return role.track || "specialist";
}

// ── חישוב מלא ודירוג ───────────────────────────────────────────────────────

/**
 * הסף שתפקיד צריך לעבור כדי להיכלל בדירוג, חתוך לפי מה שהוא מסוגל לצבור.
 *
 * הסף מונע מתפקיד נישה לקפוץ ל-100% על סמך מעט מידע. אבל סף קבוע היה הופך
 * תפקיד שהניקוד המרבי שלו נמוך מהסף לבלתי ניתן להמלצה בשום שילוב תשובות
 * (כך קרה למסלולי קצונה ולאולפן ערבית). החיתוך הופך את הדרישה למחמירה
 * יותר במקרים האלה — ניקוד מלא — במקום לחסום לחלוטין.
 */
function rankThreshold(maxScoreForRole) {
  return Math.min(CONFIG.MIN_EARNED_FOR_RANK, maxScoreForRole);
}

/**
 * בונה את שלוש ההמלצות לפי מדיניות הניתוב.
 *
 * המטרה שהוגדרה: להציע בעיקר תפקידי ליבה, ובתוכם בעיקר חוקר/בלש/סייר —
 * אלא אם אין למועמד שום אינדיקציה לליבה, ואז לנתב למנהלה.
 *
 * לכן שתיים משלוש המשבצות שמורות לתפקידי ליבה (בעדיפות ל-primary), והמשבצת
 * השלישית פתוחה לתפקיד הכי מתאים שנותר — שם נכנסים היחידות המיוחדות, מז"פ
 * ושאר ההתמחויות. תפקידים ייחודיים שלא נכנסו לא נעלמים: הם מוצגים בבלוק
 * נפרד ("גם התאימו לך"), כדי שהמדיניות לא תסתיר מהמועמד מידע רלוונטי.
 */
function selectTop(ranked, profile, all, byRank) {
  const N = CONFIG.TOP_N;
  const picked = [];
  const taken = new Set();

  const take = entry => {
    if (!entry || taken.has(entry.id) || picked.length >= N) return;
    picked.push(entry);
    taken.add(entry.id);
  };

  // התאמת כפפה נלקחת לפני כל משבצת שמורה, בשני המסלולים. המשבצות השמורות
  // הן מדיניות אוכלוסייתית — "לרוב המועמדים כדאי להציע ליבה" — והן הנחת
  // ברירת מחדל שנועדה למי שאין עליו מידע מכריע. כשיש מידע מכריע, כלומר
  // כשהמועמד הוכשר בדיוק לתפקיד הזה, המדיניות הכללית נסוגה מפניו.
  ranked.filter(e => e.exactFit)
        .slice(0, CONFIG.EXACT_FIT_MAX_SLOTS)
        .forEach(take);
  const reserved = picked.length;

  if (isAdminTrack(profile)) {
    // אין אינדיקציה לליבה — מנהלה תחילה, ואז מה שנותר (בעיקר משל"ט,
    // שאינו דורש בוחן כושר ולכן נשאר רלוונטי גם כאן).
    //
    // בתוך המנהלה שמורות משבצות לתפקידים המרכזיים, באותו היגיון שבו שמורות
    // משבצות לליבה במסלול השני: אלה שערי הכניסה שנפתחים בניסיון כללי, בעוד
    // תפקיד מקצועי (משפט, בינוי, שכר) רלוונטי רק למי שהגיע עם ההסמכה.
    //
    // המשבצת המרכזית נספרת *מעל* הכפפה (`reserved`) ולא מתוך שלוש המשבצות.
    // רוב תפקידי המנהלה המקצועיים הם בדיוק תפקידי הכפפה, ולכן בלי ההיסט
    // הזה כל התאמה מדויקת הייתה מבטלת את ההבטחה לשער כניסה מרכזי אחד.
    const admin = ranked.filter(e => roleTrack(e.role) === "admin");
    admin.filter(e => e.role.adminTier === "central").forEach(e => {
      if (picked.length < reserved + CONFIG.ADMIN_MIN_CENTRAL_SLOTS) take(e);
    });
    admin.forEach(take);
    ranked.forEach(take);
    return { picked, track: "admin" };
  }

  // מסלול ליבה: שתי משבצות שמורות לליבה.
  //
  // כאן, בשונה מהמנהלה, הכפפה נספרת *בתוך* השתיים ולא מעליהן: `picked.length`
  // כבר מכיל אותה, ולכן אחרי המשבצת המובטחת לחוקר/בלש/סייר הספירה מגיעה ל-2
  // והמשבצת השמורה השנייה נפתחת. זה מכוון. במנהלה ההבטחה היא לתפקיד *אחד*
  // ואם הכפפה תבלע אותה לא יישאר שער כניסה כללי; בליבה ההבטחה היא לשניים,
  // וויתור על אחד מהם לטובת התפקיד שהמועמד הוכשר אליו הוא בדיוק העסקה
  // הנכונה — עדיין נשאר תפקיד ליבה ראשי אחד, ועוד משבצת פתוחה.
  //
  // הראשונה מובטחת לחוקר/בלש/סייר — הם עיקר התקנים ולכן תמיד יופיע לפחות
  // אחד מהם. השנייה פתוחה לכל תפקיד ליבה לפי הניקוד, כולל משל"ט וסייר
  // תנועה. אם שתי המשבצות היו נעולות על הליבה הראשית, משל"ט היה נדחק
  // כמעט תמיד למשבצת הפתוחה ומפסיד שם להתמחויות — וזה בדיוק מה שהסימולציה
  // הראתה. החלוקה הזו שומרת על דומיננטיות הליבה הראשית בלי לחנוק את המשל"ט.
  const core = ranked.filter(e => roleTrack(e.role) === "core");
  const corePrimary = core.filter(e => e.role.coreTier === "primary");

  take(corePrimary[0]);

  // המשבצת השמורה השנייה: ברירת המחדל היא ליבה ראשית נוספת, ומשל"ט/סייר
  // תנועה לוקחים אותה רק אם הם מובילים בפער ברור (CORE_SECONDARY_MARGIN).
  // בלי הפער הזה הליבה המשנית ניצחה כמעט תמיד; עם נעילה מלאה היא כמעט
  // לא הופיעה. הפער כויל בסימולציה כדי לפגוע ביעד של 80–90% ליבה ראשית.
  if (picked.length < CONFIG.CORE_MIN_SLOTS) {
    const nextPrimary = corePrimary.find(e => !taken.has(e.id));
    const nextSecondary = core.find(e => !taken.has(e.id) && e.role.coreTier !== "primary");

    if (nextPrimary && nextSecondary) {
      take(nextSecondary.matchPct >= nextPrimary.matchPct + CONFIG.CORE_SECONDARY_MARGIN
        ? nextSecondary : nextPrimary);
    } else {
      take(nextPrimary || nextSecondary);
    }
  }
  core.forEach(e => { if (picked.length < CONFIG.CORE_MIN_SLOTS) take(e); });

  // המשבצות השמורות הן הבטחה, לא תוצאה של הדירוג. יש פרופילים נדירים שבהם
  // רק תפקיד ליבה אחד עובר את סף הדירוג — למשל מי שסימן משרד ועבודה מול
  // עובדים, אבל גם כושר גבוה ורקע קרבי — ואז שאר תפקידי הליבה נופלים מתחת
  // לסף ושתי המשבצות מתמלאות בהתמחויות. במקרה כזה משלימים מתפקידי הליבה
  // חסרי-השער גם אם ניקודם נמוך, ומציגים את האחוז האמיתי שלהם בלי לנפח.
  if (picked.length < CONFIG.CORE_MIN_SLOTS && all) {
    all.filter(e => e.passedGates && roleTrack(e.role) === "core")
       .sort(byRank)
       .forEach(e => { if (picked.length < CONFIG.CORE_MIN_SLOTS) take(e); });
  }

  // המשבצת הפתוחה — הכי מתאים מכל מה שנותר.
  ranked.forEach(take);
  return { picked, track: "core" };
}

/**
 * הפונקציה הראשית. מקבלת answers בצורת { questionId: [optionId, ...] }.
 * מחזירה profile, top3, blocked, alsoFit (תפקידים ייחודיים שהתאימו אך לא
 * נכנסו לשלישייה), track, ו-all לצורכי דיבוג ובדיקות.
 */
function computeResults(answers) {
  const profile = buildProfile(answers);
  const questions = visibleQuestions(answers);
  const earned = computeEarned(answers, questions);
  const maxScore = computeMaxScores(questions);
  const evidence = computeEvidence(answers, questions);

  const all = ROLES.map(role => {
    const gateCheck = checkGates(role, profile);
    const roleEarned = earned[role.id] || 0;
    const roleMax = Math.max(maxScore[role.id] || 0, 1);
    const rawPct = clamp(Math.round((roleEarned / roleMax) * 100), 0, 100);
    const roleEvidence = evidence[role.id] || 0;

    // כפפה ליד: הרקע מתאים בדיוק, השערים נפתחו, ושאר התשובות תומכות.
    // שלושת התנאים נחוצים — בלי השלישי היה מספיק תואר בכלכלה כדי לדחוף
    // "שכר וגמלאות" לראש הרשימה של מי שכל שאר תשובותיו מצביעות על שטח.
    const exactFit = hasFieldMatch(role, profile) &&
                     gateCheck.passed &&
                     rawPct >= CONFIG.EXACT_FIT_MIN_RAW_PCT;

    let matchPct = rawPct;
    if (exactFit) {
      matchPct = Math.max(rawPct, CONFIG.EXACT_FIT_MIN_PCT);
    } else if (roleEvidence < CONFIG.THIN_EVIDENCE_MIN_QUESTIONS) {
      matchPct = Math.min(rawPct, CONFIG.THIN_EVIDENCE_MAX_PCT);
    }

    return {
      role,
      id: role.id,
      earned: roleEarned,
      maxScore: maxScore[role.id] || 0,
      evidence: roleEvidence,
      rawPct,
      exactFit,
      matchPct,
      passedGates: gateCheck.passed,
      unmetGates: gateCheck.unmet
    };
  });

  // התאמת כפפה קודמת לאחוז. הרצפה כבר מציבה אותה גבוה, אבל התפקיד שהמועמד
  // הוכשר אליו צריך להיות ראשון גם כשתפקיד רחב-ראיות אחר הגיע ל-100%.
  const byRank = (a, b) =>
    ((b.exactFit ? 1 : 0) - (a.exactFit ? 1 : 0)) ||
    (b.matchPct - a.matchPct) ||
    (b.earned - a.earned) ||
    (a.role.priority - b.role.priority);

  const ranked = all
    .filter(e => e.passedGates && e.earned >= rankThreshold(e.maxScore))
    .sort(byRank);

  const selection = selectTop(ranked, profile, all, byRank);
  const picked = selection.picked;

  // "תמיד ממליץ": השלמה מתפקידים חסרי-שער אם משום מה אין 3.
  if (picked.length < CONFIG.TOP_N) {
    const taken = new Set(picked.map(e => e.id));
    const fallback = selection.track === "admin"
      ? CONFIG.ADMIN_FALLBACK_ROLE_IDS.concat(CONFIG.FALLBACK_ROLE_IDS)
      : CONFIG.FALLBACK_ROLE_IDS;

    fallback.forEach(roleId => {
      if (picked.length >= CONFIG.TOP_N || taken.has(roleId)) return;
      const entry = all.find(e => e.id === roleId);
      if (!entry || !entry.passedGates) return;
      picked.push(entry);
      taken.add(roleId);
    });
  }

  // מדיניות הניתוב קובעת *אילו* תפקידים נבחרים, אבל לא את סדר התצוגה.
  // בלי המיון הזה השלישייה יכולה לצאת 58% → 35% → 53%, מה שנראה למשתמש
  // כמו תקלה. המיון מציג אותה בסדר יורד, בלי לשנות את הבחירה עצמה.
  picked.sort(byRank);

  const chosen = new Set(picked.map(e => e.id));

  // תפקידים ייחודיים שעברו את הסף אך נדחקו ע"י מדיניות הליבה.
  const alsoFit = ranked
    .filter(e => !chosen.has(e.id) && roleTrack(e.role) !== "core")
    .slice(0, CONFIG.ALSO_FIT_MAX)
    .map(e => ({ role: e.role, id: e.id, matchPct: e.matchPct }));

  // בלוק השקיפות: מה נחסם בתנאי-סף, והסיבה מתוך דרישות ה-KB.
  const blocked = all
    .filter(e => !e.passedGates && e.matchPct >= CONFIG.BLOCKED_MIN_PCT)
    .sort(byRank)
    .map(e => ({
      role: e.role,
      id: e.id,
      matchPct: e.matchPct,
      reason: e.unmetGates.map(g => g.label).join(" · ") ||
              (e.role.requirements && e.role.requirements[0]) || "",
      unmetGates: e.unmetGates
    }));

  const top3 = picked.map(e => Object.assign({}, e, {
    reasons: buildReasons(e.id, answers)
  }));

  return { profile, top3, blocked, alsoFit, track: selection.track, all, questions };
}

// ── בדיקות שפיות ───────────────────────────────────────────────────────────

/** ממיר מיפוי נוח של תשובות בודדות לצורת המערכים שהמנוע מצפה לה. */
function asAnswers(map) {
  const out = {};
  Object.keys(map).forEach(k => { out[k] = toArray(map[k]); });
  return out;
}

function runSanityChecks() {
  const results = [];
  const check = (name, passed, detail) => results.push({ name, passed, detail: detail || "" });

  // ── שלמות המטריצה ──
  const knownIds = new Set(ROLES.map(r => r.id));
  const unknownIds = [];
  QUESTIONS.forEach(q => q.options.forEach(o => {
    Object.keys(o.scores || {}).forEach(roleId => {
      if (!knownIds.has(roleId)) unknownIds.push(q.id + "/" + o.id + " → " + roleId);
    });
  }));
  check("כל roleId ב-scores קיים ב-ROLES", unknownIds.length === 0, unknownIds.join("; "));

  const knownGates = new Set(["minRifleman", "requiresCombat", "requiresCombatCommand",
    "requiresDegree", "minResilience", "minArabic", "requiresStudent",
    "requiresStudyYear", "requiresExOfficer", "requiresFieldMatch",
    "requiresVocational"]);
  const unknownGates = [];
  ROLES.forEach(r => Object.keys(r.gates || {}).forEach(g => {
    if (!knownGates.has(g)) unknownGates.push(r.id + " → " + g);
  }));
  check("כל שער ב-gates מוכר למנוע", unknownGates.length === 0, unknownGates.join("; "));

  const badTrack = ROLES.filter(r => ["core", "specialist", "admin"].indexOf(roleTrack(r)) === -1).map(r => r.id);
  check("לכל תפקיד track תקין", badTrack.length === 0, badTrack.join(", "));

  const gatedFallbacks = CONFIG.FALLBACK_ROLE_IDS.concat(CONFIG.ADMIN_FALLBACK_ROLE_IDS)
    .filter(id => { const r = getRole(id); return !r || Object.keys(r.gates || {}).length > 0; });
  check("תפקידי ברירת המחדל ללא שער", gatedFallbacks.length === 0, gatedFallbacks.join(", "));

  // ── פרופילים ──
  const low = asAnswers({
    status: "civilian", rifleman: "r02", environment: "office",
    fitness: "medium", shifts: "day", public: "backstage", curiosity: "low",
    resilience: "low", youth: "no", arabic: "none_open", tech_affinity: "low",
    patience: "low", teamwork: "solo", risk: "low", age: "45_plus", commitment: "flex"
  });
  const lowRes = computeResults(low);
  check("פרופיל ריק מחזיר 3 המלצות", lowRes.top3.length === 3, "התקבלו " + lowRes.top3.length);
  check("שאלון ללא תשובות מחזיר 3 המלצות", computeResults({}).top3.length === 3);

  // ── בחירה מרובה: סטודנט שהוא גם קצין לשעבר ──
  const both = asAnswers({
    status: ["student", "ex_officer"], study_left: "year_plus", degree_field: "other",
    rifleman: "r7", environment: ["office", "field"], fitness: "good",
    shifts: "day", public: "citizens", curiosity: "high", resilience: "high",
    youth: "open", arabic: "none_open", tech_affinity: "mid", patience: "mid",
    teamwork: "mix", risk: "mid", age: "25_34", commitment: "studies"
  });
  const bothRes = computeResults(both);
  const bothProfile = bothRes.profile;
  check("בחירה מרובה: שני הדגלים נדלקו",
        bothProfile.isStudent === true && bothProfile.isExOfficer === true);
  const bothOk = bothRes.all.find(e => e.id === "student").passedGates &&
                 bothRes.all.find(e => e.id === "officer_track").passedGates;
  check("בחירה מרובה: שני המסלולים נפתחו", bothOk === true);

  // ── יתרת לימודים ──
  const shortStudy = asAnswers(Object.assign({}, { status: "student", study_left: "less_year",
    degree_field: "other", rifleman: "r02", environment: "office",
    fitness: "medium", shifts: "day", public: "citizens", curiosity: "mid",
    resilience: "mid", youth: "open", arabic: "none_open", tech_affinity: "mid",
    patience: "mid", teamwork: "mix", risk: "mid", age: "18_24", commitment: "studies" }));
  const shortRes = computeResults(shortStudy);
  check("סטודנט עם פחות משנה — תקן הסטודנט חסום",
        shortRes.all.find(e => e.id === "student").passedGates === false);
  const longStudy = asAnswers(Object.assign({}, JSON.parse(JSON.stringify({})), {
    status: ["student"], study_left: ["year_plus"], degree_field: ["other"],
    rifleman: ["r02"], environment: ["office"], fitness: ["medium"], shifts: ["day"],
    public: ["citizens"], curiosity: ["mid"], resilience: ["mid"], youth: ["open"],
    arabic: ["none_open"], tech_affinity: ["mid"], patience: ["mid"], teamwork: ["mix"],
    risk: ["mid"], age: ["18_24"], commitment: ["studies"] }));
  check("סטודנט עם שנה ומעלה — תקן הסטודנט נפתח",
        computeResults(longStudy).all.find(e => e.id === "student").passedGates === true);

  // ── שאלות מותנות ──
  const noDegreeVisible = visibleQuestions(asAnswers({ status: "civilian" })).map(q => q.id);
  check("ללא תואר — שאלת תחום הלימודים לא מוצגת",
        noDegreeVisible.indexOf("degree_field") === -1);
  check("ללא סטודנט — שאלת יתרת הלימודים לא מוצגת",
        noDegreeVisible.indexOf("study_left") === -1);
  const gradVisible = visibleQuestions(asAnswers({ status: "graduate" })).map(q => q.id);
  check("עם תואר — שאלת תחום הלימודים מוצגת",
        gradVisible.indexOf("degree_field") !== -1);
  const studentVisible = visibleQuestions(asAnswers({ status: "student" })).map(q => q.id);
  check("סטודנט — מוצגות גם יתרת לימודים וגם תחום",
        studentVisible.indexOf("study_left") !== -1 && studentVisible.indexOf("degree_field") !== -1);

  // ── מז"פ וחוסן נפשי (הבאג מהסימולציה) ──
  const softDegree = asAnswers({
    status: "graduate", degree_field: "life_sci", rifleman: "r02",
    environment: "lab", fitness: "low", shifts: "day", public: "backstage",
    curiosity: "high", resilience: "low", youth: "no", arabic: "none_open",
    tech_affinity: "mid", patience: "mid", teamwork: "solo", risk: "low",
    age: "25_34", commitment: "long"
  });
  const softRes = computeResults(softDegree);
  const mazapIds = ["forensics_lab", "forensics_scene", "forensics_mobile"];
  check("חוסן נמוך — אף תפקיד מז\"פ לא מומלץ",
        softRes.top3.every(e => mazapIds.indexOf(e.id) === -1),
        softRes.top3.map(e => e.id).join(", "));
  check("חוסן נמוך — כל תפקידי מז\"פ חסומים",
        mazapIds.every(id => softRes.all.find(e => e.id === id).passedGates === false));

  // ── ערבית: לא מעוניין ללמוד ──
  const noArabic = asAnswers(Object.assign({}, { status: "civilian",
    rifleman: "r02", environment: "office", fitness: "medium", shifts: "day",
    public: "citizens", curiosity: "high", resilience: "mid", youth: "no",
    arabic: "none_no", tech_affinity: "mid", patience: "mid", teamwork: "mix",
    risk: "mid", age: "25_34", commitment: "long" }));
  check("לא מעוניין ללמוד ערבית — מסלול האולפן חסום",
        computeResults(noArabic).all.find(e => e.id === "arabic_investigator").passedGates === false);

  // ── ניתוב למנהלה ──
  const adminAnswers = asAnswers({
    status: "civilian", rifleman: "none", environment: "office",
    fitness: "low", shifts: "day", public: "staff", curiosity: "mid",
    resilience: "low", youth: "no", arabic: "none_no", tech_affinity: "mid",
    patience: "mid", teamwork: "solo", risk: "low", age: "35_44", commitment: "long"
  });
  const adminRes = computeResults(adminAnswers);
  check("ללא אזרחים/כושר/רובאי — ניתוב למסלול מנהלה", adminRes.track === "admin");
  check("מסלול מנהלה — ההמלצות אינן תפקידי שטח",
        adminRes.top3.every(e => ["admin", "core"].indexOf(roleTrack(e.role)) !== -1 &&
                                 (roleTrack(e.role) === "admin" || e.id === "dispatcher")),
        adminRes.top3.map(e => e.id).join(", "));
  check("מסלול ליבה נשמר כשיש אינדיקציה אחת לפחות",
        computeResults(low).track === "core");

  // ── דומיננטיות הליבה ──
  const eliteAnswers = asAnswers({
    status: "civilian", rifleman: "r7", environment: "field",
    fitness: "very_high", shifts: "nights", public: "backstage", curiosity: "low",
    resilience: "high", youth: "no", arabic: "none_open", tech_affinity: "low",
    patience: "high", teamwork: "team", risk: "high", age: "18_24", commitment: "long"
  });
  const eliteRes = computeResults(eliteAnswers);
  const coreCount = eliteRes.top3.filter(e => roleTrack(e.role) === "core").length;
  check("לוחם עילית — עדיין לפחות 2 תפקידי ליבה", coreCount >= CONFIG.CORE_MIN_SLOTS,
        eliteRes.top3.map(e => e.id).join(", "));
  check("לוחם עילית — היחידות המיוחדות מוצגות בבלוק 'גם התאימו לך'",
        eliteRes.alsoFit.some(e => ["spu_yasam", "gideonim", "yamam"].indexOf(e.id) !== -1),
        eliteRes.alsoFit.map(e => e.id).join(", "));

  // ── שאלות מבצעיות לא נשאלות ממי שלא רוצה שטח ──
  const deskOnly = asAnswers({
    status: "civilian", rifleman: "none", environment: "office",
    fitness: "low", shifts: "day", public: "staff", curiosity: "mid", resilience: "low"
  });
  const deskVisible = visibleQuestions(deskOnly).map(q => q.id);
  check("ללא שטח — לא נשאלת שאלת הסיכון המבצעי",
        deskVisible.indexOf("risk") === -1);
  check("ללא שטח — לא נשאלת שאלת התצפיות והמעקבים",
        deskVisible.indexOf("patience") === -1);
  check("ללא שטח — מוצגות שאלות ערכי-העבודה המנהלתיות",
        ["work_value", "work_object", "work_reward"].every(id => deskVisible.indexOf(id) !== -1));

  const fieldWanted = asAnswers({ status: "civilian", rifleman: "r02", environment: "field", fitness: "good" });
  const fieldVisible = visibleQuestions(fieldWanted).map(q => q.id);
  check("עם שטח — שאלת הסיכון המבצעי כן מוצגת",
        fieldVisible.indexOf("risk") !== -1);
  check("עם שטח — שאלת התצפיות כן מוצגת",
        fieldVisible.indexOf("patience") !== -1);

  // נטייה חקירתית מחזירה את שאלת הסבלנות גם בלי שטח — היא רלוונטית לבלש.
  const deskCurious = asAnswers({
    status: "civilian", rifleman: "none", environment: "office",
    fitness: "low", public: "backstage", curiosity: "high"
  });
  const curiousVisible = visibleQuestions(deskCurious).map(q => q.id);
  check("נטייה חקירתית מחזירה את שאלת התצפיות",
        curiousVisible.indexOf("patience") !== -1);
  check("נטייה חקירתית לא מחזירה את שאלת הסיכון המבצעי",
        curiousVisible.indexOf("risk") === -1);

  // ── שאלות ערכי-העבודה מפרידות בין תפקידי המנהלה ──
  // כל שילוב של ערך + מושא עבודה + מקור סיפוק אמור להוביל לתפקיד אחר.
  // בלי השאלות האלה כל תפקידי המנהלה קיבלו ניקוד כמעט זהה.
  const adminBase = {
    status: "civilian", rifleman: "none", environment: "office",
    fitness: "low", shifts: "day", public: "staff", curiosity: "mid",
    resilience: "low", youth: "no", arabic: "none_no", tech_affinity: "mid",
    teamwork: "mix", age: "35_44", commitment: "long"
  };
  const adminCases = [
    { name: "רווחה",     answers: { work_value: "help_people", work_object: "people",    work_reward: "helped" },     expect: "admin_welfare",       degree: "health_social" },
    { name: "הדרכה",     answers: { work_value: "learning",    work_object: "people",    work_reward: "taught" },     expect: "admin_training" },
    { name: "לוגיסטיקה", answers: { work_value: "order",       work_object: "equipment", work_reward: "ran_smooth" }, expect: "admin_logistics" },
    // שני התפקידים הבאים הם מקצועיים, ולכן הם רלוונטיים רק למי שהגיע עם
    // הרקע שהתפקיד עצמו דורש — תואר בכלכלה לשכר, ורקע טכנולוגי לתקשוב.
    { name: "שכר",       answers: { work_value: "analysis",    work_object: "numbers",   work_reward: "unblocked" },  expect: "admin_payroll",      degree: "econ" },
    { name: "מדיה",      answers: { work_value: "creativity",  work_object: "documents", work_reward: "created" },    expect: "admin_media" },
    { name: "תקשוב",     answers: { work_value: "analysis",    work_object: "systems",   work_reward: "ran_smooth" }, expect: "admin_tech_support", degree: "tech" }
  ];
  const wrong = [];
  adminCases.forEach(c => {
    const merged = Object.assign({}, adminBase, c.answers);
    if (c.degree) { merged.status = ["civilian", "graduate"]; merged.degree_field = c.degree; }
    const res = computeResults(asAnswers(merged));
    if (res.top3[0].id !== c.expect) {
      wrong.push(c.name + " → " + res.top3[0].id + " (צפוי " + c.expect + ")");
    }
  });
  check("ערכי-העבודה מפרידים נכון בין תפקידי המנהלה", wrong.length === 0, wrong.join("; "));

  // שאלות ערכי-העבודה לא מוצגות למי שאינו מנהלתי.
  const fieldOnly = visibleQuestions(asAnswers({
    status: "civilian", rifleman: "r5", environment: "field", fitness: "very_high", public: "citizens"
  })).map(q => q.id);
  check("פרופיל שטח — שאלות ערכי-העבודה לא מוצגות",
        ["work_value", "work_object", "work_reward"].every(id => fieldOnly.indexOf(id) === -1));

  // ── תפקידי מנהלה מקצועיים דורשים רקע מתאים ──
  // רגרסיה על באג שדווח: בוגר מדעי החיים, שלא נשאל ולא אמר מילה על תזונה,
  // קיבל "הסעדה ותזונה" בהתאמה 100%. הסיבה הייתה שלתפקיד לא היה שער כלל,
  // וכל ניקודו הגיע מאותות גנריים של מנהלה (משרד, שעות יום, מול עובדים).
  const lifeSciAdmin = computeResults(asAnswers(Object.assign({}, adminBase, {
    status: ["civilian", "graduate"], degree_field: "life_sci",
    work_value: "order", work_object: "equipment", work_reward: "ran_smooth"
  })));
  const lifeSciIds = lifeSciAdmin.top3.map(e => e.id);
  check("בוגר מדעי החיים לא מקבל הסעדה/רפואה",
        lifeSciIds.indexOf("admin_food") === -1 && lifeSciIds.indexOf("admin_medical") === -1,
        lifeSciIds.join(", "));

  // תפקיד שההסמכה שלו כלל אינה נשאלת בשאלון לא יומלץ לאיש — בשום פרופיל.
  const vocational = ROLES.filter(r => (r.gates || {}).requiresVocational);
  const vocationalLeaked = vocational.filter(r =>
    checkGates(r, buildProfile(asAnswers(Object.assign({}, adminBase, {
      status: ["civilian", "graduate"], degree_field: "life_sci"
    })))).passed).map(r => r.id);
  check("תפקידים שדורשים הסמכה שאינה נשאלת — תמיד חסומים",
        vocational.length > 0 && vocationalLeaked.length === 0, vocationalLeaked.join(", "));

  // ומנגד: שער ההסמכה נפתח למי שכן הגיע עם הרקע הנכון.
  const engineerAdmin = computeResults(asAnswers(Object.assign({}, adminBase, {
    status: ["civilian", "graduate"], degree_field: "engineering",
    work_value: "analysis", work_object: "equipment", work_reward: "ran_smooth"
  })));
  check("רקע בהנדסה פותח את בינוי ותשתיות",
        engineerAdmin.all.filter(e => e.id === "admin_facilities")[0].passedGates);

  // במסלול המנהלה תמיד מוצע לפחות שער כניסה מרכזי אחד.
  let noCentral = 0;
  [["econ", "numbers"], ["law", "documents"], ["engineering", "equipment"], ["tech", "systems"]]
    .forEach(pair => {
      const r = computeResults(asAnswers(Object.assign({}, adminBase, {
        status: ["civilian", "graduate"], degree_field: pair[0],
        work_value: "analysis", work_object: pair[1], work_reward: "unblocked"
      })));
      if (!r.top3.some(e => e.role.adminTier === "central")) noCentral++;
    });
  check("מסלול מנהלה — תמיד לפחות תפקיד מרכזי אחד", noCentral === 0, noCentral + " חריגים");

  // ── התאמת כפפה ──
  // רגרסיה על באג שדווח: סטודנט/ית לעבודה סוציאלית שאינו/ה רוצה שטח קיבל/ה
  // "משרת סטודנט" 100%, ואחריו חוקר ובלש ב-48% — בעוד תקן עוזר/ת לעובד/ת
  // סוציאלי/ת, שהוא בדיוק התפקיד שהרקע שלו מכשיר, נדחק ל"גם התאימו לך".
  // הסיבה: שתי משבצות שמורות לליבה נלקחו לפי מדיניות ולא לפי התאמה.
  const socialStudent = asAnswers({
    status: ["student"], study_left: "year_plus", degree_field: "health_social",
    rifleman: "none", environment: "office", fitness: "low", shifts: "day",
    public: "citizens", work_value: "help_people", work_object: "people",
    work_reward: "helped", curiosity: "mid", resilience: "mid", youth: "love",
    arabic: "none_no", tech_affinity: "low", teamwork: "mix", age: "18_24",
    commitment: "studies"
  });
  const socialRes = computeResults(socialStudent);
  check("סטודנט/ית לעבודה סוציאלית — התקן המתאים ראשון",
        socialRes.top3[0].id === "student_social_assistant",
        socialRes.top3.map(e => e.id + " " + e.matchPct + "%").join(", "));
  check("סטודנט/ית לעבודה סוציאלית — ההתאמה מעל רצפת הכפפה",
        socialRes.top3[0].matchPct >= CONFIG.EXACT_FIT_MIN_PCT,
        socialRes.top3[0].matchPct + "%");
  check("כפפה במסלול ליבה — עדיין נשאר תפקיד ליבה ראשי",
        socialRes.top3.some(e => ["patrol", "detective", "investigator"].indexOf(e.id) !== -1),
        socialRes.top3.map(e => e.id).join(", "));

  // בוגר/ת עבודה סוציאלית — אותו היגיון, אבל התקן המקצועי המלא.
  const socialGraduate = computeResults(asAnswers(Object.assign({}, adminBase, {
    status: ["civilian", "graduate"], degree_field: "health_social",
    work_value: "help_people", work_object: "people", work_reward: "helped"
  })));
  check("בוגר/ת עבודה סוציאלית — רווחה ראשונה בהתאמת כפפה",
        socialGraduate.top3[0].id === "admin_welfare" && socialGraduate.top3[0].exactFit === true,
        socialGraduate.top3.map(e => e.id + " " + e.matchPct + "%").join(", "));

  // הגבול השני של הכלל: תואר מתאים אינו מספיק כשכל שאר התשובות מצביעות
  // למקום אחר. בלי התנאי הזה בוגר כלכלה שרוצה שטח היה מקבל "שכר וגמלאות"
  // בראש הרשימה רק מפני שהשער נפתח לו.
  const econField = computeResults(asAnswers({
    status: ["graduate"], degree_field: "econ", rifleman: "r5",
    environment: "field", fitness: "very_high", shifts: "nights",
    public: "citizens", curiosity: "mid", resilience: "high", youth: "no",
    arabic: "none_open", tech_affinity: "low", patience: "mid", teamwork: "team",
    risk: "high", age: "25_34", commitment: "long"
  }));
  check("תואר מתאים בלי תשובות תומכות — אין התאמת כפפה",
        econField.all.find(e => e.id === "admin_payroll").exactFit === false,
        "אחוז גולמי " + econField.all.find(e => e.id === "admin_payroll").rawPct + "%");

  // תפקיד שנחסם בשער אינו מקבל כפפה, גם כשהתחום מתאים בדיוק: סטודנט/ית
  // לעבודה סוציאלית עדיין אינו/ה עובד/ת סוציאלי/ת מוסמך/ת.
  const welfareEntry = socialRes.all.find(e => e.id === "admin_welfare");
  check("תפקיד חסום אינו מקבל התאמת כפפה",
        welfareEntry.passedGates === false && welfareEntry.exactFit === false);

  // ── רוחב הראיות ──
  // "משרת סטודנט" נשען על ארבע שאלות בלבד, ולכן כל סטודנט הגיע אצלו ל-100%
  // — מעל התאמות שנשענות על שתים-עשרה שאלות. התקרה מחזירה את הפרופורציה.
  const studentEntry = socialRes.all.find(e => e.id === "student");
  check("תפקיד שנשען על מעט שאלות אינו מוצג כהתאמה כמעט מושלמת",
        studentEntry.evidence < CONFIG.THIN_EVIDENCE_MIN_QUESTIONS &&
        studentEntry.rawPct === 100 && studentEntry.matchPct === CONFIG.THIN_EVIDENCE_MAX_PCT,
        "ראיות " + studentEntry.evidence + " שאלות, " +
        studentEntry.rawPct + "% → " + studentEntry.matchPct + "%");
  check("תקרת הראיות הדקות נמוכה מרצפת הכפפה",
        CONFIG.THIN_EVIDENCE_MAX_PCT < CONFIG.EXACT_FIT_MIN_PCT);

  // כל התפקידים שמקורם באתר הרשמי חייבים דרישות אמיתיות ולא שדות ריקים.
  const siteNoReq = ROLES.filter(r => r.source === "site" &&
    (!r.requirements || r.requirements.length === 0)).map(r => r.id);
  check("לכל תפקיד מהאתר הרשמי יש דרישות", siteNoReq.length === 0, siteNoReq.join(", "));

  // ── תקינות כללית ──
  const badPct = lowRes.all.filter(e => e.matchPct < 0 || e.matchPct > 100).map(e => e.id);
  check("כל האחוזים בטווח 0–100", badPct.length === 0, badPct.join(", "));
  const fullMax = computeMaxScores(QUESTIONS);
  const unreachable = ROLES.filter(r => (fullMax[r.id] || 0) === 0).map(r => r.id);
  check("לכל תפקיד יש ניקוד מרבי חיובי", unreachable.length === 0, unreachable.join(", "));
  const unrankable = ROLES.filter(r => (fullMax[r.id] || 0) < rankThreshold(fullMax[r.id] || 0)).map(r => r.id);
  check("כל תפקיד ניתן להמלצה בשילוב תשובות כלשהו", unrankable.length === 0, unrankable.join(", "));

  const addedWithFacts = ROLES.filter(r => r.source !== "kb" &&
    (r.salary != null || r.training != null || r.advancement != null)).map(r => r.id);
  check("לתפקידים שמחוץ למאגר אין נתוני שכר/הכשרה מומצאים",
        addedWithFacts.length === 0, addedWithFacts.join(", "));

  return results;
}

if (typeof window !== "undefined" && typeof CONFIG !== "undefined" && CONFIG.DEBUG) {
  const checks = runSanityChecks();
  const failed = checks.filter(c => !c.passed);
  checks.forEach(c => console[c.passed ? "log" : "error"](
    (c.passed ? "✓" : "✗") + " " + c.name + (c.detail ? " — " + c.detail : "")
  ));
  console.log(failed.length === 0
    ? "בדיקות השפיות עברו: " + checks.length + "/" + checks.length
    : "בדיקות שנכשלו: " + failed.length);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildProfile, visibleQuestions, computeEarned, computeMaxScores, computeEvidence,
    checkGates, hasFieldMatch, buildReasons, computeResults, runSanityChecks,
    getRole, getQuestion, isAdminTrack, roleTrack, asAnswers, toArray
  };
}
