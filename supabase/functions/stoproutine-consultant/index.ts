// Supabase Edge Function `stoproutine-consultant` (Deno).
// Spec: docs/consultant-spec.md, section "Server". Secrets: ANTHROPIC_API_KEY, STOPROUTINE_TELEGRAM_BOT_TOKEN,
// STOPROUTINE_TELEGRAM_CHAT_ID, STOPROUTINE_IP_HASH_SALT (set by the owner). SUPABASE_DB_URL comes from the platform (direct Postgres connection; the schema need not be exposed in the API).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import postgres from "npm:postgres@3.4.5";
import { FIXED_REPLIES, mapNote, SYSTEM_PROMPTS, type Lang } from "./prompt.ts";
import { PROJECT_IDS, sanitizeOutput, type ModelOutput, type RoutineMap } from "./sanitize.ts";

const MODEL = "claude-opus-5-5";
const MAX_USER_CHARS = 1500;
const MAX_USER_MESSAGES = 14;
const MAX_IP_PER_HOUR = 40;
const MAX_ASSISTANT_CHARS = 6000;

const ALLOWED_ORIGINS = ["https://stoproutine.com", "https://www.stoproutine.com"];
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  const ok = allowedOrigin(origin);
  if (ok) h["Access-Control-Allow-Origin"] = ok;
  return h;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

// Structured output schema. Structured outputs need additionalProperties:false everywhere and
// every key listed in `required`; nullable values use anyOf with {type:"null"}.
// "Exactly 3 processes" cannot be expressed (minItems/maxItems are not supported), so it is
// stated in the prompt and enforced in sanitizeOutput().
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    map: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            summary: { type: "string" },
            processes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  what_ai_does: { type: "string" },
                  human_checks: { type: "string" },
                  similar_project: { type: "string", enum: [...PROJECT_IDS] },
                  weekly_hours: { anyOf: [{ type: "number" }, { type: "null" }] },
                  hours_basis: { type: "string" },
                },
                required: ["name", "what_ai_does", "human_checks", "similar_project", "weekly_hours", "hours_basis"],
                additionalProperties: false,
              },
            },
            next_step: { type: "string" },
          },
          required: ["summary", "processes", "next_step"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["reply", "map"],
  additionalProperties: false,
};

type Msg = { role: "user" | "assistant"; content: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBody(b: unknown): { lang: Lang; sessionId: string; messages: Msg[] } | { error: string } {
  if (!b || typeof b !== "object") return { error: "bad_request" };
  const o = b as Record<string, unknown>;
  if (o.lang !== "uk" && o.lang !== "en") return { error: "bad_lang" };
  if (typeof o.sessionId !== "string" || !UUID.test(o.sessionId)) return { error: "bad_session" };
  if (!Array.isArray(o.messages) || o.messages.length === 0 || o.messages.length > 40) return { error: "bad_messages" };
  const messages: Msg[] = [];
  for (const m of o.messages as Record<string, unknown>[]) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return { error: "bad_messages" };
    const content = m.content.trim();
    if (content === "") return { error: "bad_messages" };
    if (m.role === "user" && content.length > MAX_USER_CHARS) return { error: "too_long" };
    messages.push({ role: m.role, content: m.role === "assistant" ? content.slice(0, MAX_ASSISTANT_CHARS) : content });
  }
  if (messages[0].role !== "user" || messages[messages.length - 1].role !== "user") return { error: "bad_messages" };
  for (let i = 1; i < messages.length; i++) if (messages[i].role === messages[i - 1].role) return { error: "bad_messages" };
  return { lang: o.lang, sessionId: o.sessionId, messages };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (req.headers.get("cf-connecting-ip") || (xff ? xff.split(",")[0] : "") || "unknown").trim();
}

function formatForTelegram(lang: Lang, sessionId: string, messages: Msg[], map: RoutineMap): string {
  const lines: string[] = [];
  lines.push(`StopRoutine consultant: new routine map (${lang})`);
  lines.push(`Session: ${sessionId}`);
  lines.push("");
  lines.push(`Company: ${map.summary}`);
  lines.push("");
  map.processes.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}`);
    lines.push(`   AI: ${p.what_ai_does}`);
    lines.push(`   Person checks: ${p.human_checks}`);
    lines.push(`   Similar project: ${p.similar_project}`);
    lines.push(`   Hours/week: ${p.weekly_hours ?? "null"} (${p.hours_basis})`);
  });
  lines.push("");
  lines.push(`Next step: ${map.next_step}`);
  lines.push("");
  lines.push("Visitor's answers:");
  messages.filter((m) => m.role === "user").forEach((m, i) => lines.push(`${i + 1}) ${m.content}`));
  const text = lines.join("\n");
  return text.length > 4000 ? text.slice(0, 3990) + "\n[cut]" : text;
}

async function sendTelegram(text: string): Promise<boolean> {
  const token = Deno.env.get("STOPROUTINE_TELEGRAM_BOT_TOKEN")?.trim();
  const chat = Deno.env.get("STOPROUTINE_TELEGRAM_CHAT_ID")?.trim();
  if (!token || !chat) { // secrets unset: skip, but say so in the log
    console.error("telegram secrets missing", { token: !!token, chat: !!chat });
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    });
    if (!r.ok) console.error("telegram send failed", r.status, (await r.text()).slice(0, 300)); // ответ Telegram, токена в нём нет
    return r.ok;
  } catch (e) {
    console.error("telegram send error", e instanceof Error ? e.message : String(e));
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!allowedOrigin(origin)) return json({ error: "forbidden_origin" }, 403, origin);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400, origin);
  }
  const parsed = parseBody(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400, origin);
  const { lang, sessionId, messages } = parsed;

  const salt = Deno.env.get("STOPROUTINE_IP_HASH_SALT");
  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!salt || !dbUrl || !Deno.env.get("ANTHROPIC_API_KEY")) {
    return json({ error: "server_not_configured" }, 500, origin);
  }

  const sql = postgres(dbUrl, { max: 1, prepare: false });
  try {
    return await handle();
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }

  async function handle(): Promise<Response> {

  // Per-IP hourly limit. The raw address is hashed with the secret salt and then dropped.
  const ipHash = await sha256Hex(`${salt}:${clientIp(req)}`);
  let within: boolean;
  try {
    const r = await sql`select stoproutine.consultant_hit(${ipHash}, ${MAX_IP_PER_HOUR}) as ok`;
    within = r[0]?.ok === true;
  } catch (e) {
    console.error("rate check failed", e instanceof Error ? e.message : String(e));
    return json({ error: "storage_error" }, 500, origin);
  }
  if (!within) return json({ error: "rate_limited" }, 429, origin);

  const userCount = messages.filter((m) => m.role === "user").length;
  if (userCount > MAX_USER_MESSAGES) {
    return json({ reply: FIXED_REPLIES[lang].limit, map: null, done: true }, 200, origin);
  }

  // What this session already holds (map shown before, notification sent before).
  let priorMap: RoutineMap | null = null;
  let alreadyNotified = false;
  try {
    const rows = await sql`select map, notified from stoproutine.consultant_sessions where id = ${sessionId}`;
    if (rows.length) {
      priorMap = (rows[0].map ?? null) as RoutineMap | null;
      alreadyNotified = rows[0].notified === true;
    }
  } catch (e) {
    console.error("session read failed", e instanceof Error ? e.message : String(e));
    return json({ error: "storage_error" }, 500, origin);
  }

  // First block is identical for every request of a language (cached). The per-session note comes after it.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM_PROMPTS[lang], cache_control: { type: "ephemeral" } },
  ];
  if (priorMap) system.push({ type: "text", text: mapNote(lang, JSON.stringify(priorMap)) });

  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  let out: ModelOutput | null = null;
  let fixedReply: string | null = null;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages,
      output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });

    // Check stop_reason before reading content.
    if (response.stop_reason === "refusal") {
      fixedReply = FIXED_REPLIES[lang].refusal;
    } else if (response.stop_reason === "max_tokens") {
      fixedReply = FIXED_REPLIES[lang].max_tokens;
    } else {
      const textBlock = response.content.find((b) => b.type === "text");
      let raw: unknown = null;
      try {
        raw = textBlock && textBlock.type === "text" ? JSON.parse(textBlock.text) : null;
      } catch {
        raw = null;
      }
      out = sanitizeOutput(raw, lang);
      if (!out) return json({ error: "bad_model_output" }, 502, origin);
    }
  } catch (e) {
    console.error("anthropic error", e instanceof Error ? e.message : String(e));
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503, origin);
    return json({ error: "upstream_error" }, 502, origin);
  }

  const reply = out ? out.reply : (fixedReply as string);
  const newMap = out ? out.map : null;
  const mapToStore = newMap ?? priorMap;

  // Store the conversation (user messages as received, plus this reply).
  const stored = out ? [...messages, { role: "assistant", content: reply }] : messages;
  try {
    await sql`
      insert into stoproutine.consultant_sessions (id, lang, messages, map, ip_hash, notified)
      values (${sessionId}, ${lang}, ${sql.json(stored)}, ${mapToStore === null ? null : sql.json(mapToStore)}, ${ipHash}, ${alreadyNotified})
      on conflict (id) do update set
        updated_at = now(), lang = excluded.lang, messages = excluded.messages,
        map = excluded.map, ip_hash = excluded.ip_hash, notified = excluded.notified`;
  } catch (e) {
    console.error("session store failed", e instanceof Error ? e.message : String(e));
  }

  // Telegram: once per session, when a map is produced for the first time.
  if (newMap && !alreadyNotified) {
    const sent = await sendTelegram(formatForTelegram(lang, sessionId, messages, newMap));
    if (sent) {
      try {
        await sql`update stoproutine.consultant_sessions set notified = true where id = ${sessionId}`;
      } catch (e) {
        console.error("notified flag failed", e instanceof Error ? e.message : String(e));
      }
    }
  }

  const done = newMap !== null || priorMap !== null || userCount >= MAX_USER_MESSAGES;
  return json({ reply, map: newMap, done }, 200, origin);
  }
});
