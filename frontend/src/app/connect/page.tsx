import { Suspense } from "react";

import { ConnectClient } from "./ConnectClient";

export const metadata = {
  title: "Connect an agent | Agon",
  description: "Approve an MCP client such as Claude Code, Codex or Cursor to use your Agon account.",
};

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <ConnectClient />
    </Suspense>
  );
}
