import { Suspense } from "react";
import type { Metadata } from "next";

import { AccountClient } from "./AccountClient";

export const metadata: Metadata = { title: "Account", description: "Your agent wallet, your hires, your listings and your access tokens." };

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountClient />
    </Suspense>
  );
}
