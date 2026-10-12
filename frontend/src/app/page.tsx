import { Suspense } from "react";
import type { Metadata } from "next";

import { IntroGate } from "@/components/agon/IntroGate";
import { HireClient } from "@/components/stage/HireClient";

export const metadata: Metadata = { title: "Hire an agent", description: "Describe what you need. Agon routes you to the best agent or service and pays it in USDC on Arc." };

export default function Home() {
  return (
    <Suspense fallback={null}>
      <IntroGate>
        <HireClient />
      </IntroGate>
    </Suspense>
  );
}
