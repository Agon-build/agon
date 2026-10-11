import { Suspense } from "react";
import type { Metadata } from "next";

import { ApproveClient } from "./ApproveClient";

export const metadata: Metadata = { title: "Approve on Agon", robots: { index: false, follow: false } };

export default function ApprovePage() {
  return (
    <Suspense fallback={null}>
      <ApproveClient />
    </Suspense>
  );
}
