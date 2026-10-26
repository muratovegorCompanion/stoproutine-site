// Local mock of the stoproutine-consultant endpoint, for testing the UI without the real API.
// Usage: node mock-server.mjs [port]   (default 8787)
// Same shape as the real function: POST {lang, sessionId, messages} -> {reply, map|null, done}.
// Canned questions; after 3 user messages it returns a map. ALL map content here is FAKE sample data.
import http from "node:http";

const port = Number(process.argv[2] || process.env.PORT || 8787);

const QUESTIONS = {
  uk: [
    "Зрозуміло. Скільки людей у команді і які задачі повторюються щодня? (МОК-ВІДПОВІДЬ)",
    "Де зараз живуть ці дані і скільки часу це займає? (МОК-ВІДПОВІДЬ)",
  ],
  en: [
    "Got it. How many people are on the team and which tasks repeat every day? (MOCK REPLY)",
    "Where does that data live now, and how long does it take? (MOCK REPLY)",
  ],
};

const SAMPLE = (lang) => ({
  summary: lang === "uk" ? "[ЗРАЗОК, ВИГАДАНІ ДАНІ] Невелика компанія, що живе в Excel і пошті" : "[SAMPLE, FAKE DATA] A small company living in Excel and email",
  processes: [
    { name: lang === "uk" ? "[ЗРАЗОК] Зведення прайсів від постачальників" : "[SAMPLE] Merging supplier price lists",
      what_ai_does: lang === "uk" ? "Зводить файли в одну таблицю й показує джерело кожної цифри." : "Merges the files into one table and shows the source of each number.",
      human_checks: lang === "uk" ? "Менеджер підтверджує рядки, де ШІ не впевнений." : "A manager confirms the rows where the AI is unsure.",
      similar_project: "tender", weekly_hours: 30, hours_basis: lang === "uk" ? "[вигадано] 3 людини × 2 год/день × 5 днів = 30" : "[fake] 3 people x 2 h/day x 5 days = 30" },
    { name: lang === "uk" ? "[ЗРАЗОК] Перевірка договорів" : "[SAMPLE] Contract checking",
      what_ai_does: lang === "uk" ? "Порівнює договір зі стандартними умовами й готує правки." : "Compares the contract with standard terms and drafts edits.",
      human_checks: lang === "uk" ? "Юрист затверджує кожну правку." : "A lawyer approves every edit.",
      similar_project: "contracts", weekly_hours: null, hours_basis: lang === "uk" ? "недостатньо даних" : "not enough data" },
    { name: lang === "uk" ? "[ЗРАЗОК] Заявки з сайту" : "[SAMPLE] Website inquiries",
      what_ai_does: lang === "uk" ? "Надсилає кожну заявку в Telegram із джерелом реклами." : "Sends each inquiry to Telegram with its ad source.",
      human_checks: lang === "uk" ? "Менеджер вирішує, кому передати заявку." : "A manager decides who takes the inquiry.",
      similar_project: "site", weekly_hours: null, hours_basis: lang === "uk" ? "недостатньо даних" : "not enough data" },
  ],
  next_step: lang === "uk" ? "[ЗРАЗОК] Пройтися по карті на безкоштовному розборі на 30 хвилин." : "[SAMPLE] Go through the map on a free 30-minute call.",
});

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, apikey, x-client-info");
};

http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let b;
    try { b = JSON.parse(raw); } catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end('{"error":"bad_json"}'); }
    const lang = b.lang === "en" ? "en" : "uk";
    const users = (b.messages || []).filter((m) => m.role === "user");
    const last = (users[users.length - 1] || {}).content || "";
    const send = (code, obj) => setTimeout(() => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }, 1500);
    if (/RATELIMIT/.test(last)) return send(429, { error: "rate_limited" });
    if (users.length === 3) {
      return send(200, { reply: lang === "uk" ? "Карта готова (мок)." : "The map is ready (mock).", map: SAMPLE(lang), done: true });
    }
    if (users.length > 3) {
      return send(200, { reply: lang === "uk" ? "Деталі, ціну й строк фіксують на розборі з директором. (МОК-ВІДПОВІДЬ)" : "Details, price and timeline are fixed on the review call with the director. (MOCK REPLY)", map: null, done: true });
    }
    send(200, { reply: QUESTIONS[lang][users.length - 1], map: null, done: false });
  });
}).listen(port, "127.0.0.1", () => console.log("mock consultant on http://127.0.0.1:" + port + "/"));
