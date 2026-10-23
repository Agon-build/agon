import { Suspense } from "react";
import type { Metadata } from "next";

import { WatchClient } from "./WatchClient";

export const metadata: Metadata = { title: "Resolution Watch", description: "Settlement alerts for the Polymarket markets you watch." };

export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <WatchClient />
    </Suspense>
  );
}
