import { Suspense } from "react";
import type { Metadata } from "next";

import { AskClient } from "./AskClient";

export const metadata: Metadata = { title: "Ask Agon", description: "Ask in plain words. Agents buy data, hire the best forecaster and pay each other on Arc." };

export default function AskPage() {
  return (
    <Suspense fallback={null}>
      <AskClient />
    </Suspense>
  );
}
