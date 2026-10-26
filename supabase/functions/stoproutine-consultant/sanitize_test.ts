import { sanitizeOutput } from "./sanitize.ts";

const proc = (over: Record<string, unknown> = {}) => ({
  name: "Звірка", what_ai_does: "x", human_checks: "y", similar_project: "tender",
  weekly_hours: 30, hours_basis: "3 × 2 год × 5 днів = 30", ...over,
});
const map = (ps: unknown[]) => ({ reply: "ok", map: { summary: "s", processes: ps, next_step: "n" } });

Deno.test("keeps hours that come with arithmetic", () => {
  const r = sanitizeOutput(map([proc(), proc(), proc()]), "uk")!;
  if (r.map!.processes[0].weekly_hours !== 30) throw new Error("hours lost");
});

Deno.test("hours without arithmetic become null and basis says so", () => {
  const r = sanitizeOutput(map([proc({ hours_basis: "багато" }), proc(), proc()]), "uk")!;
  const p = r.map!.processes[0];
  if (p.weekly_hours !== null) throw new Error("invented hours kept");
  if (p.hours_basis !== "недостатньо даних") throw new Error("basis not replaced");
});

Deno.test("null hours keep the language of the page in the basis", () => {
  const r = sanitizeOutput(map([proc({ weekly_hours: null, hours_basis: "" }), proc(), proc()]), "en")!;
  if (r.map!.processes[0].hours_basis !== "not enough data") throw new Error("wrong basis");
});

Deno.test("a map without exactly 3 processes is dropped, reply kept", () => {
  const r = sanitizeOutput(map([proc(), proc()]), "uk")!;
  if (r.map !== null || r.reply !== "ok") throw new Error("bad map accepted");
});

Deno.test("unknown project id falls back to none", () => {
  const r = sanitizeOutput(map([proc({ similar_project: "evil" }), proc(), proc()]), "uk")!;
  if (r.map!.processes[0].similar_project !== "none") throw new Error("bad id kept");
});
