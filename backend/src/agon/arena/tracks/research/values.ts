import type { ValueType } from "../../types.ts";

/// Reading a value of a stated type out of whatever an agent delivered. Every
/// value has one normal form, so "1,234,567" and "1234567" are the same answer.

const MAX_DEPTH = 12;
const MAX_CHARS = 200_000;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const DAY_FIRST = new RegExp(`(?<![\\w])(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})(?!\\d)`, "gi");
const MONTH_FIRST = new RegExp(`(?<![a-z])${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, "gi");
const ADDRESS = /(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const NUMBER = /(\$\s?)?(?<![\w.])(\d[\d,]*)(\.\d+)?(?![\w])(\s?(?:usdc|usd|dollars)\b)?/gi;

const ymd = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const grouped = (digits: string): string | null => {
  const s = digits.replace(/,+$/, "");
  if (!s.includes(",")) return s;
  return /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : null;
};
const plainInt = (s: string) => s.replace(/^0+(?=\d)/, "");

function datesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ISO_DATE)) { const v = ymd(+m[1]!, +m[2]!, +m[3]!); if (v) out.push(v); }
  for (const m of text.matchAll(DAY_FIRST)) { const v = ymd(+m[3]!, MONTHS[m[2]!.toLowerCase()]!, +m[1]!); if (v) out.push(v); }
  for (const m of text.matchAll(MONTH_FIRST)) { const v = ymd(+m[3]!, MONTHS[m[1]!.toLowerCase()]!, +m[2]!); if (v) out.push(v); }
  return out;
}

/// Text with everything that holds digits but is not a count taken out: links, hex, dates and times.
const withoutNoise = (text: string) => text
  .replace(/https?:\/\/\S+/gi, " ")
  .replace(/0x[0-9a-fA-F]+/g, " ")
  .replace(ISO_DATE, " ").replace(DAY_FIRST, " ").replace(MONTH_FIRST, " ")
  .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, " ");

function numbersIn(text: string, want: "integer" | "amount"): string[] {
  const out: string[] = [];
  for (const m of withoutNoise(text).matchAll(NUMBER)) {
    const whole = grouped(m[2]!);
    if (whole === null) continue;
    const isAmount = Boolean(m[1] || m[3] || m[4]);
    if (want === "integer" && !isAmount) out.push(plainInt(whole));
    if (want === "amount" && isAmount) out.push(`${plainInt(whole)}.${(m[3] ?? ".").slice(1).padEnd(6, "0").slice(0, 6)}`);
  }
  return out;
}

const cleanName = (raw: string) => raw.toLowerCase().replace(/[\s\u00a0]+/g, " ").replace(/^[\s"'`.,:;!?()[\]]+|[\s"'`.,:;!?()[\]]+$/g, "");

/// Every value of the type found in a text, in normal form, each once. Names have no list: see hasName.
export function valuesIn(type: ValueType, text: string): string[] {
  const found = type === "address" ? [...text.matchAll(ADDRESS)].map((m) => m[0].toLowerCase())
    : type === "date" ? datesIn(text)
      : type === "integer" || type === "amount" ? numbersIn(text, type)
        : [];
  return [...new Set(found)];
}

/// The normal form of one value, or null when it is not a value of that type.
export function normalise(type: ValueType, raw: string): string | null {
  if (type === "name") return cleanName(raw) || null;
  const found = valuesIn(type, raw.trim());
  return found.length === 1 ? found[0]! : null;
}

/// Whether a name appears in a text as a whole phrase.
export function hasName(text: string, name: string): boolean {
  const want = cleanName(name);
  if (!want) return false;
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text.toLowerCase());
}

/// What an agent's answer says. A result with a top-level `value` is read from that
/// field alone; anything else is read whole: every string and number at any depth.
export function answerText(result: unknown): string {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const value = (result as Record<string, unknown>).value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value).slice(0, MAX_CHARS);
  }
  const parts: string[] = [];
  let size = 0;
  const walk = (v: unknown, depth: number) => {
    if (size >= MAX_CHARS || depth > MAX_DEPTH) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
      const s = String(v).slice(0, MAX_CHARS - size);
      parts.push(s);
      size += s.length;
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) walk(item, depth + 1);
    }
  };
  walk(result, 0);
  return parts.join("\n");
}

/// The distinct values of a type an answer commits to.
export function candidates(type: ValueType, result: unknown): string[] {
  return valuesIn(type, answerText(result));
}
