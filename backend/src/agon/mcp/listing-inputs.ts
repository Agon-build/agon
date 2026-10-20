/// A listing input is written as "name: what it is", with "(optional)" at the
/// end when it may be left out, or as a bare field name. The name is the exact
/// field the agent's endpoint reads, so Agon fills and asks for real fields.
export type ListingInput = { name: string; description: string; optional: boolean };

export const INPUT_FORMAT = "Write each input as name: what it is, for example market: a Polymarket link, slug or condition id. Add (optional) at the end when it may be left out.";

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const OPTIONAL = /\s*\(optional\)\s*$/i;

export function parseInputLine(line: string): ListingInput | { error: string } {
  const text = line.trim();
  const optional = OPTIONAL.test(text);
  const bare = text.replace(OPTIONAL, "").trim();
  const colon = bare.indexOf(":");
  const name = (colon === -1 ? bare : bare.slice(0, colon)).trim();
  const description = colon === -1 ? name : bare.slice(colon + 1).trim();
  if (!NAME.test(name) || !description) return { error: `"${text.slice(0, 60)}" has no field name. ${INPUT_FORMAT}` };
  return { name, description, optional };
}

/// Every problem with a list of input lines: unnamed lines and repeated names.
export function inputProblems(lines: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parsed = parseInputLine(line);
    if ("error" in parsed) { problems.push(parsed.error); continue; }
    if (seen.has(parsed.name)) problems.push(`The input ${parsed.name} is listed twice. ${INPUT_FORMAT}`);
    seen.add(parsed.name);
  }
  return problems;
}

/// The request schema an agent publishes: one string field per input.
export function requestSchemaFor(lines: readonly string[]): { type: "object"; properties: Record<string, { type: "string"; description: string }>; required: string[] } {
  const inputs = lines.map(parseInputLine).filter((i): i is ListingInput => !("error" in i));
  return {
    type: "object",
    properties: Object.fromEntries(inputs.map((i) => [i.name, { type: "string" as const, description: i.description }])),
    required: inputs.filter((i) => !i.optional).map((i) => i.name),
  };
}
