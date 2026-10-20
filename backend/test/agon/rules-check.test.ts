import assert from "node:assert/strict";
import test from "node:test";

import { readRulesReply, rulesCheck, rulesRisk, rulesSignals } from "../../src/agon/agents/rules-check.ts";

const SUIT = `This market will resolve to "Yes" if Volodymyr Zelenskyy wears a suit while meeting with President Donald Trump between March 3 and December 31, 2025 ET. Otherwise, this market will resolve to "No".

A meeting is defined as any encounter where both Zelenskyy and Trump are present and interact with each other in person.

The resolution source will be a consensus of credible reporting.`;

const reply = (o: unknown) => `Here is the check:\n${JSON.stringify(o)}`;

test("a trap whose quote is not in the rules is dropped, never shown", () => {
  const out = readRulesReply(reply({
    traps: [
      { category: "definition", kind: "ambiguous", quote: "wears a suit while meeting", explain: "Suit is never defined." },
      { category: "source", kind: "ambiguous", quote: "Polymarket will decide at its sole discretion", explain: "Invented." },
    ],
  }), SUIT);
  assert.deepEqual(out.traps.map((t) => t.quote), ["wears a suit while meeting"]);
});

test("quotes verify across curly quotes, line breaks and case", () => {
  const out = readRulesReply(reply({
    decides: { source: { text: "Credible reporting", quote: "THE RESOLUTION SOURCE will be a consensus of credible reporting" }, cutoff: null, threshold: null },
    traps: [{ category: "fallback", kind: "fine_print", quote: "resolve to “No”.\n\nA meeting is defined", explain: "x" }],
  }), SUIT);
  assert.equal(out.decides.source?.text, "Credible reporting");
  assert.equal(out.traps.length, 1);
});

test("a quote from the market title counts, so a headline that differs from the rules is shown", () => {
  const out = readRulesReply(reply({ traps: [{ category: "timing", kind: "ambiguous", quote: "Will Zelensky wear suit next Trump meeting?", explain: "The title says next meeting; the rules cover any meeting." }] }), SUIT, "Will Zelensky wear suit next Trump meeting?");
  assert.equal(out.traps.length, 1);
  assert.equal(readRulesReply(reply({ traps: [{ category: "timing", kind: "ambiguous", quote: "Will Zelensky wear suit next Trump meeting?", explain: "x" }] }), SUIT).traps.length, 0);
});

test("a reply that is not JSON gives no traps and no decides fields", () => {
  assert.deepEqual(readRulesReply("I cannot help with that.", SUIT), { decides: { source: null, cutoff: null, threshold: null }, traps: [] });
  assert.deepEqual(readRulesReply("", SUIT).traps, []);
});

test("unknown categories, empty quotes and more than five traps are trimmed", () => {
  const many = Array.from({ length: 7 }, () => ({ category: "definition", kind: "ambiguous", quote: "wears a suit", explain: "x" }));
  assert.equal(readRulesReply(reply({ traps: [...many, { category: "vibes", kind: "ambiguous", quote: "wears a suit", explain: "x" }, { category: "timing", kind: "ambiguous", quote: "", explain: "x" }] }), SUIT).traps.length, 5);
});

test("signals read the source, judgment words, a fallback, the timezone and past disputes", () => {
  assert.deepEqual(rulesSignals(SUIT, []), { source: "consensus", discretion: false, fallback: false, timezone: true, disputes: 0 });
  const mixed = "Resolution source: official information from the governments of the US and Ukraine and a consensus of credible reporting. If the event is cancelled, this market resolves No.";
  assert.deepEqual(rulesSignals(mixed, ["proposed", "disputed", "proposed", "disputed"]), { source: "mixed", discretion: false, fallback: true, timezone: false, disputes: 2 });
  assert.equal(rulesSignals("Resolved at the sole discretion of the market maker.", []).discretion, true);
  assert.equal(rulesSignals("The resolution source will be the Binance BTC/USDT 1 minute candle.", []).source, "named");
  assert.equal(rulesSignals("Yes if it happens.", []).source, "none");
});

test("dispute risk follows the table in the spec", () => {
  const base = { source: "official" as const, discretion: false, fallback: true, timezone: true, disputes: 0 };
  const amb = { category: "definition" as const, kind: "ambiguous" as const, quote: "q", explain: "e" };
  const fine = { ...amb, kind: "fine_print" as const };
  assert.equal(rulesRisk(base, []), "low");
  assert.equal(rulesRisk(base, [fine, fine]), "low");
  assert.equal(rulesRisk(base, [amb]), "medium");
  assert.equal(rulesRisk({ ...base, source: "consensus" }, []), "medium");
  assert.equal(rulesRisk({ ...base, source: "none" }, []), "medium");
  // Where a feed or an official source decides, two open points are still only medium (Jensen Huang flip, no dispute).
  assert.equal(rulesRisk(base, [amb, { ...amb, category: "timing" }]), "medium");
  assert.equal(rulesRisk({ ...base, source: "named" }, [amb, amb]), "medium");
  assert.equal(rulesRisk(base, [amb, amb, { ...amb, category: "source" }]), "high");
  assert.equal(rulesRisk({ ...base, source: "consensus" }, [amb]), "high");
  // Official sources listed with credible reporting is boilerplate on most markets (Senate control): not high on its own.
  assert.equal(rulesRisk({ ...base, source: "mixed" }, [amb]), "medium");
  assert.equal(rulesRisk({ ...base, discretion: true }, []), "high");
  assert.equal(rulesRisk({ ...base, disputes: 1 }, []), "high");
});

test("a full check combines the reply, the signals and the risk", () => {
  const out = rulesCheck({ rules: SUIT, umaStatuses: [] }, reply({ traps: [{ category: "definition", kind: "ambiguous", quote: "wears a suit", explain: "Suit is never defined." }] }));
  assert.equal(out.risk, "high");
  assert.equal(out.traps[0]!.category, "definition");
  assert.equal(out.signals.source, "consensus");
});
