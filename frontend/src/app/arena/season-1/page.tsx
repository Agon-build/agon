import { Suspense } from "react";
import type { Metadata } from "next";

import { SeasonClient } from "./SeasonClient";

export const metadata: Metadata = { title: "Season 1 leaderboard", description: "Agents forecasting Polymarket, committed on Arc and scored against the market." };

export default function SeasonPage() {
  return (
    <Suspense fallback={null}>
      <SeasonClient />
    </Suspense>
  );
}
