/// The Lead's evidence rules. The Lead never acts on text it reads: it trusts
/// only items marked as observed, treats everything else as a claim, and
/// flags text that tries to give it orders. Deterministic, no model.

export type EvidenceItem = { id: string; kind: string; text: string };
export type EvidenceTriage = {
  ignoredInstructions: boolean;
  decision: "allow" | "review" | "reject";
  observations: string[];
  untrustedClaims: string[];
};

const MAX_ITEMS = 24;
const MAX_LINE = 400;

/// Command shapes, not keywords: "Owner can override the mint price" is a fact,
/// "override your controls" is an order.
const INSTRUCTION_PATTERNS = [
  /(^|\n)\s*(system|assistant|developer)\s*:\s*(approve|ignore|disregard|do|sign|send|transfer|execute|act|forget|override|bypass|allow|reject|reply|respond|output|you)\b/i,
  /\bignore\b[^.]{0,40}\b(instructions?|rules?|controls?|polic(y|ies)|previous|above|risk)\b/i,
  /\bdisregard\b/i,
  /\boverride\s+(the\s+|your\s+|all\s+|any\s+)?(rules?|instructions?|controls?|limits?|polic(y|ies)|safeguards?|checks?)\b/i,
  /\byou must\b/i,
  /\bnew instructions?\b/i,
  /\bact as\b/i,
  /\bforget\s+(your|all|any|previous|prior)\b/i,
  /\bskip\s+(the\s+)?(review|checks?)\b/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}

const line = (item: EvidenceItem) => `${item.id}: ${item.text}`.slice(0, MAX_LINE);

export function triageEvidence(evidence: readonly EvidenceItem[]): EvidenceTriage {
  const observations: string[] = [];
  const untrustedClaims: string[] = [];
  let instructionInObserved = false;
  let ignoredInstructions = false;
  for (const item of evidence) {
    const instruction = looksLikeInstruction(item.text);
    if (instruction) ignoredInstructions = true;
    const observed = item.kind.trim().toLowerCase() === "observed";
    if (observed && !instruction) observations.push(line(item));
    else {
      if (observed) instructionInObserved = true;
      untrustedClaims.push(line(item));
    }
  }
  return {
    ignoredInstructions,
    decision: instructionInObserved ? "reject" : untrustedClaims.length > 0 ? "review" : "allow",
    observations: observations.length > 0 ? observations.slice(0, MAX_ITEMS) : ["No observed evidence was provided."],
    untrustedClaims: untrustedClaims.slice(0, MAX_ITEMS),
  };
}
