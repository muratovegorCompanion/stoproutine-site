# AI consultant on stoproutine.com — specification

## What it is
A chat consultant on the site, presented by an avatar of Egor Muratov (founder and director of StopRoutine).
It asks the visitor 5–7 short questions about their business, then shows a **«Карта рутини» / "Routine map"**:
three processes worth handing to AI first. The map is shown to everyone immediately, no contact required.
Every finished conversation is sent to Egor (Telegram) and stored.

## Identity and honesty rules (non-negotiable)
- It introduces itself as **«ШІ-асистент Єгора Муратова»** / **"Egor Muratov's AI assistant"** — never as Egor himself, never claims to be human.
- It never promises results, timelines, discounts or anything not on the site. Prices: only the published ones —
  UA: розбір 30 хв безкоштовно; аудит відділу від 15 000 грн (зараховується у пілот); пілот від $2,500, 3–4 тижні; підтримка від $300/міс.
  EN: free 30-minute call; audit from $1,500 (credited to the pilot); pilot from $4,500, 3–4 weeks; support from $450/mo.
  Exact price and timeline are always "fixed after the review".
- Time estimates come **only from numbers the visitor gave** ("3 people × 2 h/day ≈ 30 h/week"), with the arithmetic shown.
  If the visitor gave no numbers for a process, the estimate is null and the map says so. Never invent statistics, percentages or client names.
- It asks the visitor not to share personal data of their clients. No medical, legal or financial advice.
- It stays on topic (the visitor's routine and StopRoutine). Off-topic or abusive requests → one polite redirect.
- One question per message, short and plain. Language = the page language (uk or en).

## Conversation flow
1. Greeting + what will happen ("5–7 questions, then a routine map") + the personal-data notice.
2. Questions (adapt, skip what is already answered): what the company does; team size; which tasks repeat every day/week;
   where data lives (Excel, 1C, email, messengers, CRM); how much time those tasks take (people × hours);
   what goes wrong (errors, delays, lost requests); what they would free the team for.
3. After at most 7 visitor answers (or earlier if enough is known) → produce the map.
4. After the map: offer «Обговорити з директором StopRoutine» (Telegram link) and stay available for follow-up questions (max 14 visitor messages total).

## Map content (structured)
For each of exactly 3 processes:
- `name` — in the visitor's own words
- `what_ai_does` — concrete, 1–2 sentences
- `human_checks` — where a person stays in the loop (StopRoutine principle: AI sorts, a person confirms)
- `similar_project` — one of `app | tender | contracts | uchet | villa | site | none` (the site's six projects; see below)
- `weekly_hours` — number or null; `hours_basis` — the arithmetic from the visitor's numbers, or "not enough data"
Plus `summary` (one line about the company) and `next_step` (one sentence).

Projects (for matching, describe them truthfully):
- app — health-insurance app with an AI chat answering employees from their policy documents
- tender — compares 10–15 insurers' Excel offers into one table; each value links to its source cell
- contracts — checks a contract against the broker's standard edits and drafts the redline + letter
- uchet — browser accounting instead of 1C: contracts, payments, insurer reports, bank matching, commissions
- villa — AI manager of two Airbnb villas: guests, cleaner, pool service; owner approves messages
- site — B2B site where every lead arrives in Telegram with its ad source

## Avatar
Video clips (square, muted, no speech) in `/avatar/`: `greet.mp4`, `idle.mp4` (loops), `think.mp4`, `present.mp4`, plus `poster.jpg`.
Play `greet` once on open → `idle` loop; while waiting for a reply → `think` then back to `idle`; when the map arrives → `present` then `idle`.
Respect `prefers-reduced-motion` (show poster only). Caption under the avatar: «ШІ-асистент Єгора Муратова» / "Egor Muratov's AI assistant".

## UI
- Entry points: a floating button bottom-right on the home view («Розібрати мою рутину з ШІ» / "Map my routine with AI");
  the existing inline button «Розібрати мою рутину →» in the automation panel opens the consultant instead of Telegram (UA and EN equivalents).
  All other Telegram buttons stay as they are.
- Panel: right-side panel on desktop (≈420px), full-screen sheet on phones. Avatar on top, messages, input, send button, close.
- Disclaimer under the input: "AI can make mistakes. Don't share your clients' personal data." (UA translation on the UA page).
- Map rendered as a card in the chat: three blocks + similar-project link (opens that project page on the site) + "Copy" button (plain text) + CTA to Telegram.
- Same visual language as the site (navy/lime, Inter). No layout shift of the existing film/scroll.

## Server: Supabase Edge Function `stoproutine-consultant`
Project: `chaloklum-villa` (ref `bsywzzzzizfvmuerqlqr`), schema `stoproutine` (isolated from other apps there).
- `POST {lang, sessionId, messages:[{role:"user"|"assistant", content:string}]}` → `{reply, map|null, done:boolean}`.
- CORS: `https://stoproutine.com`, `https://www.stoproutine.com`, `http://127.0.0.1:*`, `http://localhost:*`.
- Limits: user message ≤ 1500 chars; ≤ 14 user messages per session; ≤ 40 requests per IP per hour (hash IP with a secret salt; never store raw IP).
- Model: Anthropic Messages API via the official TypeScript SDK (`npm:@anthropic-ai/sdk`), model `claude-opus-5-5`, `output_config.effort: "low"`,
  structured output (`output_config.format` JSON schema: `{reply: string, map: object|null}`), server-side refusal fallback
  (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`); check `stop_reason` before reading content; on refusal return a polite generic reply.
- Storage: table `stoproutine.consultant_sessions(id uuid pk, created_at, updated_at, lang, messages jsonb, map jsonb, ip_hash text, notified boolean)`. RLS on, no public policies; function uses the service role.
- Notification: when a map is produced the first time in a session, send it + the visitor's answers to Telegram (`STOPROUTINE_TELEGRAM_BOT_TOKEN`, `STOPROUTINE_TELEGRAM_CHAT_ID`). If those secrets are unset, skip silently.
- Secrets (set by the owner, never in code): `ANTHROPIC_API_KEY` (shared with the project), `STOPROUTINE_TELEGRAM_BOT_TOKEN`, `STOPROUTINE_TELEGRAM_CHAT_ID`, `STOPROUTINE_IP_HASH_SALT`.
  The project is shared with other bots: never read or write `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`.
- The site reads the endpoint URL from `<meta name="consultant-endpoint">`; if empty, the floating button is hidden.
