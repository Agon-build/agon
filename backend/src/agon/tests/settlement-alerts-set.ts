/// Settlement sequences for the settlement-alerts test, shaped like Gamma market
/// readings and following Polymarket's documented process (checked 2026-10-22,
/// docs.polymarket.com/developers/resolution/UMA): a proposal, an optional
/// dispute and second proposal, then final prices of 1 and 0. Each reading is one
/// check by the watcher; expected lists the alert raised at each step. The last
/// case is the calm control: prices move but nothing settles, so no alert.
export type SettlementCase = { question: string; readings: Record<string, unknown>[]; expected: { step: number; kind: string }[] };

const RULES = "This market resolves Yes if the Bank of Canada leaves its target rate unchanged at the October 28 announcement.";
const at = (over: Record<string, unknown>) => ({ closed: false, outcomes: '["Yes","No"]', outcomePrices: '["0.42","0.58"]', description: RULES, ...over });

export const SETTLEMENT_SET: readonly SettlementCase[] = [
  {
    question: "Will the Bank of Canada hold in October?",
    readings: [at({}), at({ umaResolutionStatus: "proposed", outcomePrices: '["0.97","0.03"]' }), at({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1","0"]' })],
    expected: [{ step: 1, kind: "settlement_started" }, { step: 2, kind: "settled" }],
  },
  {
    question: "Trump x Ukraine mineral deal signed before May?",
    readings: [
      at({}), at({ umaResolutionStatus: "proposed", outcomePrices: '["0.9","0.1"]' }), at({ umaResolutionStatus: "disputed", outcomePrices: '["0.6","0.4"]' }),
      at({ umaResolutionStatus: "proposed", outcomePrices: '["0.2","0.8"]' }), at({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0","1"]' }),
    ],
    expected: [{ step: 1, kind: "settlement_started" }, { step: 2, kind: "challenged" }, { step: 3, kind: "settlement_started" }, { step: 4, kind: "settled" }],
  },
  {
    question: "Will the Bank of Canada hold in October?",
    readings: [
      at({}), at({ description: `${RULES} Clarification: an emergency move before October 28 counts as a change.` }),
      at({ description: `${RULES} Clarification: an emergency move before October 28 counts as a change.`, umaResolutionStatus: "proposed" }),
      at({ description: `${RULES} Clarification: an emergency move before October 28 counts as a change.`, umaResolutionStatus: "proposed" }),
    ],
    expected: [{ step: 1, kind: "rules_changed" }, { step: 2, kind: "settlement_started" }],
  },
  {
    question: "Will the Bank of Canada hold in October?",
    readings: [at({}), at({ outcomePrices: '["0.61","0.39"]' }), at({ closed: true, outcomePrices: '["0.64","0.36"]' })],
    expected: [],
  },
];
