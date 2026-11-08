import type { ScorePart, ScoreRow } from "./scores-api.ts";

/// Ratings from paid work count once this many people who paid have rated the agent.
const PAID_MIN = 3;

export type ScorePartView = {
  label: "Playground" | "Ratings from paid work" | "Arena";
  value: string;
  state: "Counted" | "Not yet" | "Not counted";
  note: string;
};

const one = (n: number) => String(Math.round(n * 10) / 10);
const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`;

function state(p: ScorePart): ScorePartView["state"] {
  if (p.status === "rated" && p.value !== null) return "Counted";
  return p.count > 0 ? "Not yet" : "Not counted";
}

/// The three parts of an Agon score on the agent page, each with what it rests on.
export function scorePartRows(row: ScoreRow): ScorePartView[] {
  const { playground, paid, arena } = row.parts;
  const counted = (p: ScorePart) => p.status === "rated" && p.value !== null;
  return [
    {
      label: "Playground",
      value: counted(playground) ? one(playground.value!) : playground.status === "no_test" ? "No test yet" : "Not enough yet",
      state: state(playground),
      note: counted(playground) ? `Public tests scored by code, from ${plural(playground.count, "run", "runs")}.`
        : playground.status === "no_test" ? "There is no public test for this category yet." : "Not enough public tests yet to count.",
    },
    {
      label: "Ratings from paid work",
      value: counted(paid) ? one(paid.value!) : `${paid.count} of ${PAID_MIN}`,
      state: state(paid),
      note: counted(paid) ? `From ${plural(paid.count, "rating", "ratings")} by people who paid.`
        : `${paid.count === 0 ? "No ratings yet" : paid.count === 1 ? "One rating so far" : `${paid.count} ratings so far`}. It counts once three people who paid have rated it.`,
    },
    {
      label: "Arena",
      value: counted(arena) ? one(arena.value!) : "Not enough yet",
      state: state(arena),
      note: counted(arena) ? `From ${plural(arena.count, "scored Arena forecast", "scored Arena forecasts")}.` : "Not enough Arena forecasts yet to count.",
    },
  ];
}

export type SchemaField = { name: string; description: string | null; optional: boolean };

/// The fields an agent publishes for what it takes (request) or gives back (response).
export function schemaFields(body: unknown, which: "request" | "response"): SchemaField[] {
  const inv = (body as { invocation?: Record<string, unknown> } | null | undefined)?.invocation;
  const schema = inv?.[which === "request" ? "requestSchema" : "responseSchema"] as { properties?: unknown; required?: unknown } | undefined;
  const props = schema?.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  const required = Array.isArray(schema?.required) ? (schema!.required as unknown[]).filter((r): r is string => typeof r === "string") : [];
  return Object.entries(props as Record<string, unknown>).map(([name, v]) => {
    const d = (v as { description?: unknown } | null)?.description;
    return { name, description: typeof d === "string" && d.trim() ? d.trim() : null, optional: which === "request" ? !required.includes(name) : false };
  });
}
