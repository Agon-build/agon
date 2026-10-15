import { Suspense } from "react";

import { AgonPlayground } from "@/components/agon/AgonPlayground";

export default function PlaygroundPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas px-6 py-16 font-mono text-xs uppercase tracking-[0.14em] text-ink-3">OPENING THE PLAYGROUND...</div>}>
      <AgonPlayground />
    </Suspense>
  );
}
