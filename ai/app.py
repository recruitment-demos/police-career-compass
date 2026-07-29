"""
ai/app.py — proxy אופציונלי לשכבת הסבר בשפה טבעית.

לא נדרש להרצת האפליקציה. הליבה דטרמיניסטית לחלוטין ורצה בלי שרת ובלי מפתח.
הדגמת GitHub Pages רצה תמיד במצב הדטרמיליסטי, עם CONFIG.ENABLE_AI_EXPLANATION=false.

מה השכבה הזו עושה — ומה היא לא עושה:
  • היא מנסחת מחדש את ההסבר "למה זה מתאים לך", בשפה חמה ואישית יותר.
  • היא **לא** משנה את הדירוג, את אחוזי ההתאמה ואת העובדות. אלה חושבו בצד
    הלקוח לפני הקריאה הזו, וכבר מוצגים על המסך.
  • המודל מקבל בפרומפט אך ורק את העובדות מה-KB ואת התשובות של המשתמש,
    עם הוראה מפורשת לא להוסיף שום נתון משלו.

המפתח נשאר בצד השרת בלבד. אין להטמיע מפתח API בקוד צד-לקוח.

הרצה:
    pip install flask flask-cors anthropic
    export ANTHROPIC_API_KEY=...        # ב-Windows: set ANTHROPIC_API_KEY=...
    python ai/app.py
ואז ב-data/config.js:  ENABLE_AI_EXPLANATION: true
"""

import json
import os

from flask import Flask, jsonify, request

try:
    from flask_cors import CORS
except ImportError:  # לא חובה כשמגישים את האפליקציה מאותו מקור
    CORS = None

import anthropic

MODEL = "claude-sonnet-5"
MAX_TOKENS = 900
PORT = int(os.environ.get("PORT", "5055"))

SYSTEM_PROMPT = """אתה עוזר ניסוח במרכז הגיוס של משטרת ישראל.

קיבלת רשימה של תפקידים שכבר דורגו והותאמו למועמד/ת על ידי מנוע ניקוד
דטרמיניסטי. התפקיד שלך הוא ניסוח בלבד.

חוקים מחייבים:
1. אל תשנה, אל תפרש מחדש ואל תערער על אחוזי ההתאמה או על סדר הדירוג.
2. השתמש אך ורק בעובדות שמופיעות בקלט. אל תוסיף נתוני שכר, משך הכשרה,
   דרישות, סטטיסטיקות או הבטחות שלא נמסרו לך במפורש.
3. אם נתון חסר בקלט — אל תמציא אותו ואל תרמוז עליו. פשוט אל תזכיר אותו.
4. אל תבטיח קבלה לתפקיד. זהו כלי הערכה עצמית אינדיקטיבי בלבד, וההחלטה
   הרשמית מתקבלת רק בתהליך המיון.
5. כתוב בעברית, בגוף שני, 2–3 משפטים לכל תפקיד. חם ואישי, בלי שיווקיות מוגזמת.

החזר JSON תקין בלבד, בלי טקסט עוטף ובלי code fences, במבנה:
{"explanations": {"<roleId>": "<טקסט>", ...}}
"""

app = Flask(__name__)
if CORS is not None:
    CORS(app)


def _client():
    """יוצר לקוח Anthropic. המפתח נקרא מהסביבה בלבד."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY אינו מוגדר בסביבה.")
    return anthropic.Anthropic(api_key=api_key)


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "has_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "model": MODEL,
    })


@app.post("/api/explain")
def explain():
    payload = request.get_json(silent=True) or {}
    roles = payload.get("answers") or []

    if not roles:
        return jsonify({"explanations": {}})

    user_content = (
        "להלן התפקידים שדורגו, אחוזי ההתאמה שחושבו, הבחירות שהובילו לכך, "
        "והעובדות מהמאגר. נסח לכל תפקיד 2–3 משפטים.\n\n"
        + json.dumps(roles, ensure_ascii=False, indent=2)
    )

    try:
        message = _client().messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = "".join(block.text for block in message.content if block.type == "text").strip()
        data = json.loads(raw)
        explanations = data.get("explanations", {})
        if not isinstance(explanations, dict):
            raise ValueError("מבנה תשובה לא צפוי מהמודל")

    except Exception as exc:  # noqa: BLE001 — כל כשל כאן חייב ליפול בחן
        # הלקוח כבר מציג את הנימוקים הדטרמיניסטיים; החזרת שגיאה פשוט משאירה אותם.
        app.logger.warning("שכבת ההסבר נכשלה: %s", exc)
        return jsonify({"error": "explanation_unavailable"}), 503

    return jsonify({"explanations": explanations})


if __name__ == "__main__":
    print(f"proxy ההסבר עלה על http://127.0.0.1:{PORT}  (מצב AI — רשות בלבד)")
    app.run(host="127.0.0.1", port=PORT, debug=False)
