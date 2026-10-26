// Pure checks on model output. Kept separate so they can be tested without the network.
import { NOT_ENOUGH_DATA, type Lang } from "./prompt.ts";

export const PROJECT_IDS = ["app", "tender", "contracts", "uchet", "villa", "site", "none"] as const;

export type Process = {
  name: string;
  what_ai_does: string;
  human_checks: string;
  similar_project: (typeof PROJECT_IDS)[number];
  weekly_hours: number | null;
  hours_basis: string;
};
export type RoutineMap = { summary: string; processes: Process[]; next_step: string };
export type ModelOutput = { reply: string; map: RoutineMap | null };

const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Returns a validated ModelOutput or null if the shape is wrong.
 * A map that does not have exactly 3 well-formed processes is dropped (map = null), not repaired.
 * Never-invent rule: a number of hours is kept only when hours_basis shows arithmetic (contains a digit);
 * otherwise the number is discarded and the basis is replaced with "not enough data".
 */
export function sanitizeOutput(raw: unknown, lang: Lang): ModelOutput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isStr(o.reply) || o.reply.trim() === "") return null;
  const reply = o.reply.trim();
  if (o.map === null || o.map === undefined) return { reply, map: null };
  const m = o.map as Record<string, unknown>;
  if (!m || typeof m !== "object" || !isStr(m.summary) || !isStr(m.next_step) || !Array.isArray(m.processes) || m.processes.length !== 3) {
    return { reply, map: null };
  }
  const processes: Process[] = [];
  for (const p of m.processes as Record<string, unknown>[]) {
    if (!p || !isStr(p.name) || !isStr(p.what_ai_does) || !isStr(p.human_checks) || !isStr(p.hours_basis)) {
      return { reply, map: null };
    }
    const sp = (PROJECT_IDS as readonly string[]).includes(p.similar_project as string)
      ? (p.similar_project as Process["similar_project"])
      : "none";
    let hours: number | null = typeof p.weekly_hours === "number" && Number.isFinite(p.weekly_hours) && p.weekly_hours >= 0
      ? p.weekly_hours
      : null;
    let basis = p.hours_basis.trim();
    if (hours !== null && !/\d/.test(basis)) hours = null;
    if (hours === null) basis = NOT_ENOUGH_DATA[lang];
    processes.push({
      name: p.name.trim(),
      what_ai_does: p.what_ai_does.trim(),
      human_checks: p.human_checks.trim(),
      similar_project: sp,
      weekly_hours: hours,
      hours_basis: basis,
    });
  }
  return { reply, map: { summary: m.summary.trim(), processes, next_step: m.next_step.trim() } };
}
