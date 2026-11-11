/// Order books for the true-numbers test, in the shape and order Polymarket's CLOB sends them:
/// prices and sizes as text, bids lowest first, asks highest first, so the best price is last.
/// An agent that takes the first level as the best price gets every number wrong.
export type TrueNumbersCase = {
  question: string;
  side: "buy" | "sell";
  sizeUsd: number;
  book: { asset_id: string; bids: { price: string; size: string }[]; asks: { price: string; size: string }[] };
};

export const TRUE_NUMBERS_SET: readonly TrueNumbersCase[] = [
  // The size fits inside the best ask.
  {
    question: "Will the central bank cut rates at its next meeting?", side: "buy", sizeUsd: 40,
    book: {
      asset_id: "1001",
      bids: [{ price: "0.44", size: "300" }, { price: "0.46", size: "250" }, { price: "0.48", size: "200" }],
      asks: [{ price: "0.55", size: "400" }, { price: "0.53", size: "300" }, { price: "0.52", size: "100" }, { price: "0.50", size: "100" }],
    },
  },
  // The size walks four ask levels.
  {
    question: "Will the home team win on Saturday?", side: "buy", sizeUsd: 400,
    book: {
      asset_id: "1002",
      bids: [{ price: "0.58", size: "900" }, { price: "0.60", size: "450" }, { price: "0.61", size: "120" }],
      asks: [{ price: "0.70", size: "800" }, { price: "0.66", size: "350" }, { price: "0.64", size: "200" }, { price: "0.63", size: "150" }, { price: "0.62", size: "80" }],
    },
  },
  // The size is larger than everything on offer.
  {
    question: "Will the bill pass before the end of the month?", side: "buy", sizeUsd: 2_500,
    book: {
      asset_id: "1003",
      bids: [{ price: "0.05", size: "4000" }, { price: "0.08", size: "1500" }, { price: "0.10", size: "600" }],
      asks: [{ price: "0.30", size: "1200" }, { price: "0.18", size: "900" }, { price: "0.14", size: "700" }, { price: "0.12", size: "500" }],
    },
  },
  // A sell that walks three bid levels.
  {
    question: "Will the launch happen this quarter?", side: "sell", sizeUsd: 300,
    book: {
      asset_id: "1004",
      bids: [{ price: "0.70", size: "500" }, { price: "0.74", size: "220" }, { price: "0.76", size: "150" }, { price: "0.77", size: "90" }],
      asks: [{ price: "0.85", size: "300" }, { price: "0.81", size: "260" }, { price: "0.79", size: "140" }],
    },
  },
];
