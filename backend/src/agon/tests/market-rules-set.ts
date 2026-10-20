/// Real Polymarket markets for the market-rules test, rules copied from Gamma on 2026-10-20.
/// disputes is Polymarket's own count of dispute rounds (umaResolutionStatuses): the mineral deal and MicroStrategy
/// markets were each disputed twice; the Zelensky suit market had one proposal and no dispute, and the Jensen Huang
/// market is the calm control.
/// expected: categories an ambiguous trap must have (disputed markets), or null for the calm control,
/// whose test is catching the tie rule without calling the market high risk.
export type MarketRulesCase = { slug: string; question: string; rules: string; disputes: number; expected: readonly string[] | null };

export const MARKET_RULES_SET: readonly MarketRulesCase[] = [
  {
    slug: "will-zelensky-wear-suit-next-trump-meeting",
    question: "Will Zelensky wear suit next Trump meeting?",
    disputes: 0,
    expected: ["definition","source"],
    rules: "This market will resolve to \"Yes\" if Volodymyr Zelenskyy wears a suit while meeting with President Donald Trump between March 3 and December 31, 2025 ET. Otherwise, this market will resolve to \"No\".\n\nA meeting is defined as any encounter where both Zelenskyy and Trump are present and interact with each other in person.\n\nThe resolution source will be a consensus of credible reporting.",
  },
  {
    slug: "trump-x-ukraine-mineral-deal-signed-before-may",
    question: "Trump x Ukraine mineral deal signed before May?",
    disputes: 2,
    expected: ["definition","timing","source"],
    rules: "This market will resolve to \"Yes\" if the United States and Ukraine enact or sign any deal between March 31 and April 30, 2025, 11:59 PM ET, that explicitly involves Ukrainian minerals. Otherwise this market will resolve to \"No\".\n\nQualifying mineral deals include but are not limited partnerships involving minerals, future rights to mineral resources, mining rights, or any other form of cooperation related to Ukrainian minerals.\n\nFor the purpose of this market \"enacted\" means that the agreement has been officially signed or otherwise formally adopted by both parties within the market’s time frame. A qualifying agreement which is signed by both parties will qualify, regardless of whether it is later ratified by relevant bodies (U.S. Congress, Verkhovna Rada, etc.). \n\nAnnouncements of an agreement will not alone qualify for a \"Yes\" resolution. \n\nThe resolution source for this market will be official information from the governments of the US and Ukraine and a consensus of credible reporting.",
  },
  {
    slug: "will-microstrategy-purchase-bitcoin-august-26-september-1",
    question: "Will MicroStrategy purchase Bitcoin August 26-September 1?",
    disputes: 2,
    expected: ["timing","definition"],
    rules: "This market will resolve to “Yes” if MicroStrategy Incorporated announces that they have acquired additional Bitcoin between the dates in the title (from 12:00 AM ET on the first date to 11:59 PM ET on the last). Otherwise, it will resolve to “No”.\n\nThe resolution source for this market will be official information from MicroStrategy or Michael Saylor.\n\nFor reference, MicroStrategy’s reported BTC holdings can be tracked at: https://www.strategy.com/purchases",
  },
  {
    slug: "will-jensen-huang-flip-ai-for-time-person-of-the-year-by-friday",
    question: "Will Jensen Huang flip AI for Time Person of the Year by Friday?",
    disputes: 0,
    expected: null,
    rules: "This market will resolve to “Yes” if, between Jensen Huang and Artificial Intelligence, Jensen Huang becomes the favorite in the \"Time 2025 Person of the Year\" (https://polymarket.com/event/time-2025-person-of-the-year?) for any two-hour period ending by December 5, 2025, 11:59 PM ET or earlier. Otherwise, this market will resolve to “No”.\n\nJensen Huang will be considered to have become the favorite for any two-hour period if he is ahead of Artificial Intelligence in more individual minutes than Artificial Intelligence is ahead of Jensen Huang during a qualifying time period.\n\nA tie in the number of minutes will resolve to \"No\".\n\nIf the underlying market resolves prior to this market, this market will immediately resolve in accordance with the underlying market’s final outcome.\n\nThe resolution source will be the underlying minute-level price data for the \"Time 2025 Person of the Year\" market, which can be viewed using the bar chart on https://derivative.polymarket.com/index/will-jensen-huang-flip-ai-for-time-person-of-the-year-by-friday or through the “Resolution” tab with the time set to show the two-hour period window. Both interfaces display the same underlying data.\n\nNote: This market will resolve according to the price scoring methodology of derivative.polymarket.com.",
  },
];
