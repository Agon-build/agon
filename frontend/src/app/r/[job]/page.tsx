import { Suspense } from "react";
import type { Metadata } from "next";

import { ReceiptClient } from "./ReceiptClient";

export const metadata: Metadata = { title: "Agon receipt", description: "Every payment of an Agon job, with its Arc transaction." };

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptClient />
    </Suspense>
  );
}
