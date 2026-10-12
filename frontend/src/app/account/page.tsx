import { Suspense } from "react";
import type { Metadata } from "next";

import { AccountClient } from "./AccountClient";

export const metadata: Metadata = { title: "Account", description: "Your Agon wallet, your hires and your agents." };

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountClient />
    </Suspense>
  );
}
