/* ---------------------------------------------------------------------------
   app.js — ניווט בין מסכים, רינדור ומצב.

   האפליקציה לא מחשבת כאן שום דבר: החישוב כולו ב-scoring.js, והעובדות כולן
   ב-data/roles.js. הקובץ הזה רק מציג. מצב נשמר בזיכרון בלבד.

   שתי נקודות שמשפיעות על כל הזרימה (תיקון 1):
     • תשובה היא תמיד מערך, גם בשאלת בחירה יחידה.
     • רשימת השאלות דינמית — שאלות מותנות נכנסות ויוצאות לפי התשובות,
       ולכן אין להחזיק אינדקס לתוך QUESTIONS אלא לנווט לפי מזהה שאלה.
   --------------------------------------------------------------------------- */

(function () {
  "use strict";

  // ── מצב ─────────────────────────────────────────────────────────────────

  var state = {
    questionId: null,    // מזהה השאלה המוצגת (לא אינדקס — הרשימה דינמית)
    answers: {},         // { questionId: [optionId, ...] }
    results: null,
    catalogFilter: "all",
    returnScreen: "welcome"
  };

  // ── עזרים ───────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showScreen(name) {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("is-active", screens[i].id === "screen-" + name);
    }
    $("btnRestartTop").hidden = (name === "welcome");
    $("btnCatalogTop").hidden = (name === "catalog");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** התשובות שנבחרו בשאלה, תמיד כמערך. */
  function selected(questionId) {
    var value = state.answers[questionId];
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  // ── מסך השאלון ──────────────────────────────────────────────────────────

  /**
   * רשימת השאלות הרלוונטיות כרגע. מחושבת מחדש בכל רינדור, כי סימון
   * "יש לי תואר" יכול להוסיף שאלה באמצע השאלון, וביטול הסימון להסיר אותה.
   */
  function activeQuestions() {
    return visibleQuestions(state.answers);
  }

  function currentIndex(list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === state.questionId) return i;
    }
    return -1;
  }

  function renderQuestion() {
    var list = activeQuestions();
    var index = currentIndex(list);

    // השאלה הנוכחית כבר לא רלוונטית (שינוי תשובה קודמת הסיר אותה) —
    // עוברים לשאלה הבאה שטרם נענתה.
    if (index === -1) {
      var next = list.find(function (q) { return selected(q.id).length === 0; }) || list[list.length - 1];
      state.questionId = next.id;
      index = currentIndex(list);
    }

    var question = list[index];
    var total = list.length;
    var pct = Math.round((index / total) * 100);

    $("progressLabel").textContent = "שאלה " + (index + 1) + " מתוך " + total;
    $("progressPct").textContent = pct + "%";
    var fill = $("progressFill");
    fill.style.width = pct + "%";
    fill.setAttribute("aria-valuenow", String(pct));

    $("questionText").textContent = question.text;

    var hint = $("questionHint");
    if (question.hint) {
      hint.textContent = question.hint;
      hint.hidden = false;
    } else {
      hint.hidden = true;
    }

    var host = $("optionsList");
    host.innerHTML = "";
    host.setAttribute("role", question.multi ? "group" : "radiogroup");

    var chosen = selected(question.id);

    question.options.forEach(function (option) {
      var isSelected = chosen.indexOf(option.id) !== -1;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option" + (isSelected ? " is-selected" : "") + (question.multi ? " is-multi" : "");
      btn.setAttribute("role", question.multi ? "checkbox" : "radio");
      btn.setAttribute("aria-checked", isSelected ? "true" : "false");
      btn.innerHTML = '<span class="option-dot" aria-hidden="true"></span><span>' + esc(option.label) + "</span>";

      btn.addEventListener("click", function () { selectOption(question, option.id); });
      host.appendChild(btn);
    });

    $("btnBack").disabled = (index === 0);
    $("btnNext").disabled = (chosen.length === 0);
    $("btnNext").textContent = (index === total - 1) ? "הצג תוצאות" : "הבא";
  }

  /**
   * בחירה מסמנת בלבד — המעבר לשאלה הבאה תמיד ידני, דרך כפתור "הבא" (תיקון 2).
   * בשאלה רב-בחירתית ממילא אי אפשר היה לעבור אוטומטית (אחרת לא ניתן לסמן
   * אפשרות שנייה), וכאן אותה התנהגות חלה גם על שאלה חד-בחירתית — כדי שהמשתמש
   * יוכל לשנות את דעתו לפני שהוא ממשיך, ושהקצב יהיה אחיד בכל השאלון.
   */
  function selectOption(question, optionId) {
    var chosen = selected(question.id);

    if (question.multi) {
      var at = chosen.indexOf(optionId);
      if (at === -1) chosen.push(optionId); else chosen.splice(at, 1);
      state.answers[question.id] = chosen;
    } else {
      state.answers[question.id] = [optionId];
    }

    renderQuestion();
  }

  function goNext() {
    var list = activeQuestions();
    var index = currentIndex(list);
    if (index === -1) return;
    if (selected(list[index].id).length === 0) return;

    if (index < list.length - 1) {
      state.questionId = list[index + 1].id;
      renderQuestion();
    } else {
      finish();
    }
  }

  function goBack() {
    var list = activeQuestions();
    var index = currentIndex(list);
    if (index <= 0) return;
    state.questionId = list[index - 1].id;
    renderQuestion();
  }

  // ── מסך התוצאות ─────────────────────────────────────────────────────────

  function finish() {
    state.results = computeResults(state.answers);
    $("progressFill").style.width = "100%";
    renderResults(state.results);
    showScreen("results");
    if (CONFIG.ENABLE_AI_EXPLANATION) enhanceWithAI(state.results);
  }

  function renderResults(results) {
    // כותרת שמסבירה לאיזה מסלול נותב המועמד — בלי הפתעות.
    $("resultsTitle").textContent = results.track === "admin"
      ? "3 התפקידים שהכי מתאימים לך"
      : "3 התפקידים שהכי מתאימים לך";

    $("resultsLead").textContent = results.track === "admin"
      ? "לפי התשובות שלך, תפקידי השטח פחות מתאימים כרגע — ולכן ההמלצות מתמקדות בתפקידי מנהלה ותומכי לחימה."
      : "הדירוג מחושב מהתשובות שלך בלבד. לחיצה על \"קרא/י עוד\" תפתח את התיאור המלא.";

    var container = $("topRoles");
    container.innerHTML = "";
    results.top3.forEach(function (entry, i) {
      container.appendChild(buildRoleCard(entry.role, {
        rank: i + 1,
        matchPct: entry.matchPct,
        exactFit: entry.exactFit,
        reasons: entry.reasons,
        highlight: true
      }));
    });

    renderAlsoFit(results.alsoFit);
    renderBlocked(results.blocked);
  }

  /** תפקידים ייחודיים שהתאימו אך לא נכנסו לשלישייה — כדי לא להסתיר מידע. */
  function renderAlsoFit(alsoFit) {
    var host = $("alsoFitBlock");
    host.innerHTML = "";
    if (!alsoFit || alsoFit.length === 0) return;

    var items = alsoFit.map(function (e) {
      return '<li><strong>' + esc(e.role.name) + "</strong> — <span>" +
             e.matchPct + "% התאמה · " + esc(e.role.category) + "</span></li>";
    }).join("");

    var box = document.createElement("div");
    box.className = "alsofit-block";
    box.innerHTML =
      "<h3>גם התאימו לך</h3>" +
      "<p>תפקידים ייחודיים שקיבלו התאמה טובה. ההמלצות למעלה מתמקדות בתפקידי הליבה, " +
      "שהם עיקר התקנים — אך גם אלה פתוחים בפניך.</p>" +
      '<ul class="alsofit-list">' + items + "</ul>";
    host.appendChild(box);
  }

  function renderBlocked(blocked) {
    var host = $("blockedBlock");
    host.innerHTML = "";
    if (!blocked || blocked.length === 0) return;

    var items = blocked.map(function (b) {
      return '<li><strong>' + esc(b.role.name) + '</strong> — <span>' + esc(b.reason) + "</span></li>";
    }).join("");

    var box = document.createElement("div");
    box.className = "blocked-block";
    box.innerHTML =
      "<h3>תפקידים מעניינים שדורשים תנאי-סף שלא סומנו</h3>" +
      "<p>לפי התשובות שלך, התפקידים האלה קיבלו התאמה גבוהה אך לא עמדו בתנאי-סף. " +
      "זו הצגה שקופה של המצב — לא הבטחה ולא פסילה סופית.</p>" +
      '<ul class="blocked-list">' + items + "</ul>";
    host.appendChild(box);
  }

  // ── כרטיס תפקיד ─────────────────────────────────────────────────────────

  function buildRoleCard(role, options) {
    options = options || {};
    var card = document.createElement("article");
    card.className = "role-card" + (options.highlight ? " is-top" : "") +
                     (options.exactFit ? " is-exact-fit" : "");

    var html = '<div class="role-head">';

    if (options.rank) {
      html += '<div class="rank-badge" aria-hidden="true">' + options.rank + "</div>";
    }

    html += '<div class="role-title">' +
              "<h3>" + esc(role.name) + "</h3>" +
              '<span class="tag">' + esc(role.category) + "</span>";

    // התאמת כפפה. התג עצמו קצר — טקסט ארוך היה נשבר לשתי שורות בתוך הגלולה
    // בטלפון — וההסבר מגיע במשפט נפרד מתחת לשורת התיאור.
    if (options.exactFit) {
      html += '<span class="tag tag-exact">כפפה ליד</span>';
    }

    // תג שמבדיל תפקיד שמקורו בדף התפקידים הרשמי — שם מתפרסמים תיאור
    // ודרישות אך לא שכר, הכשרה והתקדמות — מתפקיד שכל עובדותיו במאגר.
    if (role.source !== "kb") {
      html += '<span class="tag tag-added" title="התיאור והדרישות מדף התפקידים הרשמי. נתוני שכר, הכשרה והתקדמות אינם מתפרסמים שם ונמסרים במרכז הגיוס">' +
              "שכר והכשרה — נמסרים במרכז הגיוס</span>";
    }

    if (options.rank) {
      html += '<p class="role-oneliner">' + esc(role.oneLiner) + "</p>";
    }

    // בלי המשפט הזה המועמד רואה תפקיד בראש הרשימה ולא יודע *למה* הוא ראשון.
    if (options.exactFit) {
      html += '<p class="exact-note">הרקע שלך הוא בדיוק מה שהתפקיד דורש — ולכן הוא ראשון.</p>';
    }
    html += "</div>";

    if (options.matchPct != null) {
      html += '<div class="match-ring" style="--pct:' + options.matchPct + '" ' +
              'role="img" aria-label="' + options.matchPct + ' אחוז התאמה">' +
                '<div class="match-ring-text"><b>' + options.matchPct + "%</b><span>התאמה</span></div>" +
              "</div>";
    }
    html += "</div>";

    if (!options.rank) {
      html += '<p class="role-oneliner">' + esc(role.oneLiner) + "</p>";
    }

    if (options.reasons && options.reasons.length) {
      html += '<div class="why"><h4>למה זה מתאים לך</h4><ul>' +
        options.reasons.map(function (r) {
          return "<li>" + esc(r.text) + '<span class="q">' + esc(r.questionText) + "</span></li>";
        }).join("") +
        "</ul></div>";
    }

    html += buildFacts(role);

    html += '<div class="more">' +
              '<button class="more-toggle" type="button" aria-expanded="false">קרא/י עוד ▾</button>' +
              '<div class="more-body">' +
                "<h5>על התפקיד</h5><p>" + esc(role.description) + "</p>" +
                "<h5>יום בחיי</h5><p>" + esc(role.dayInLife) + "</p>" +
              "</div>" +
            "</div>";

    html += '<div class="role-actions">' +
              '<a class="btn-apply" href="' + esc(role.applyUrl) + '" target="_blank" rel="noopener">' +
                "להגשת מועמדות</a>" +
            "</div>";

    card.innerHTML = html;

    var toggle = card.querySelector(".more-toggle");
    var body = card.querySelector(".more-body");
    toggle.addEventListener("click", function () {
      var isOpen = body.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggle.textContent = isOpen ? "הצג פחות ▴" : "קרא/י עוד ▾";
    });

    return card;
  }

  /**
   * עובדות המפתח. כאן נאכף כלל הכנות: כל שדה שאין לו ערך ב-KB מוצג בדיוק
   * כ-CONFIG.SALARY_UNKNOWN, ולעולם לא כמספר משוער. זה נכון גם לתפקידים
   * שנוספו מחוץ למאגר, שכל שדות העובדות שלהם null במכוון.
   */
  function buildFacts(role) {
    var html = '<dl class="facts">';

    if (role.requirements && role.requirements.length) {
      html += '<div class="fact"><dt>דרישות ותנאי-סף</dt><dd><ul>' +
        role.requirements.map(function (req) { return "<li>" + esc(req) + "</li>"; }).join("") +
        "</ul></dd></div>";
    }

    [["משך הכשרה", role.training], ["שכר", role.salary], ["מסלול התקדמות", role.advancement]]
      .forEach(function (pair) {
        html += '<div class="fact"><dt>' + pair[0] + "</dt><dd" +
                (pair[1] ? ">" + esc(pair[1]) : ' class="is-unknown">' + esc(CONFIG.SALARY_UNKNOWN)) +
                "</dd></div>";
      });

    return html + "</dl>";
  }

  // ── קטלוג ───────────────────────────────────────────────────────────────

  function renderCatalogFilters() {
    var host = $("catalogFilters");
    host.innerHTML = "";

    var present = CATEGORIES.filter(function (cat) {
      return ROLES.some(function (r) { return r.category === cat; });
    });

    [{ id: "all", label: "הכל" }].concat(present.map(function (c) { return { id: c, label: c }; }))
      .forEach(function (item) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip" + (state.catalogFilter === item.id ? " is-active" : "");
        chip.textContent = item.label;
        chip.setAttribute("aria-pressed", state.catalogFilter === item.id ? "true" : "false");
        chip.addEventListener("click", function () {
          state.catalogFilter = item.id;
          renderCatalog();
        });
        host.appendChild(chip);
      });
  }

  function renderCatalog() {
    renderCatalogFilters();

    var list = $("catalogList");
    list.innerHTML = "";

    var shown = ROLES.filter(function (role) {
      return state.catalogFilter === "all" || role.category === state.catalogFilter;
    });

    shown.forEach(function (role) { list.appendChild(buildRoleCard(role, {})); });

    $("catalogCount").textContent =
      state.catalogFilter === "all"
        ? "כל " + ROLES.length + " התפקידים במאגר."
        : "מוצגים " + shown.length + " מתוך " + ROLES.length + " תפקידים.";
  }

  function openCatalog() {
    state.returnScreen = document.querySelector(".screen.is-active").id.replace("screen-", "");
    renderCatalog();
    showScreen("catalog");
  }

  // ── איפוס ───────────────────────────────────────────────────────────────

  function restart() {
    state.questionId = null;
    state.answers = {};
    state.results = null;
    $("progressFill").style.width = "0%";
    showScreen("welcome");
  }

  // ── שכבת הסבר AI (רשות, כבויה כברירת מחדל) ──────────────────────────────

  function enhanceWithAI(results) {
    var payload = {
      answers: results.top3.map(function (entry) {
        return {
          roleId: entry.id,
          roleName: entry.role.name,
          matchPct: entry.matchPct,
          reasons: entry.reasons.map(function (r) { return r.text; }),
          facts: {
            oneLiner: entry.role.oneLiner,
            requirements: entry.role.requirements,
            training: entry.role.training,
            salary: entry.role.salary
          }
        };
      })
    };

    fetch(CONFIG.AI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("proxy " + res.status)); })
      .then(function (data) {
        if (!data || !data.explanations) return;
        results.top3.forEach(function (entry, i) {
          var text = data.explanations[entry.id];
          if (!text) return;
          var card = $("topRoles").children[i];
          var why = card && card.querySelector(".why");
          if (!why) return;
          var p = document.createElement("p");
          p.className = "why-ai";
          p.textContent = text;
          why.appendChild(p);
        });
      })
      .catch(function () {
        if (CONFIG.DEBUG) console.warn("שכבת ההסבר של ה-AI אינה זמינה — ממשיכים במצב דטרמיניסטי.");
      });
  }

  // ── חיווט ───────────────────────────────────────────────────────────────

  function init() {
    $("welcomeDisclaimer").textContent = CONFIG.DISCLAIMER;
    $("resultsDisclaimer").textContent = CONFIG.DISCLAIMER;

    $("btnStart").addEventListener("click", function () {
      var list = activeQuestions();
      state.questionId = list[0].id;
      renderQuestion();
      showScreen("quiz");
    });

    $("btnNext").addEventListener("click", goNext);
    $("btnBack").addEventListener("click", goBack);
    $("btnRestart").addEventListener("click", restart);
    $("btnRestartTop").addEventListener("click", restart);
    $("btnCatalogTop").addEventListener("click", openCatalog);
    $("btnCatalogFromResults").addEventListener("click", openCatalog);
    $("btnCatalogBack").addEventListener("click", function () { showScreen(state.returnScreen); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
