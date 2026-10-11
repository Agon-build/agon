"use client";
import { useEffect, useState } from "react";

import { getLive, StageApiError } from "@/lib/agon/stage";
import type { LiveView } from "@/lib/agon/stage-types";
import { isTerminal } from "@/lib/agon/stage-view";

/// Polls the public live view. Keeps polling while `active` (a payment is in
/// flight) even if the view already looks final, then stops at a final phase.
export function useLiveJob(jobId: string | null, opts: { active: boolean; intervalMs?: number }): { live: LiveView | null; error: string | null } {
  const [live, setLive] = useState<LiveView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { active, intervalMs = 1000 } = opts;
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const view = await getLive(jobId);
        if (stopped) return;
        setLive(view);
        setError(null);
        if (isTerminal(view.phase) && !active) return;
      } catch (e) {
        if (stopped) return;
        setError(e instanceof StageApiError ? e.code : "request_failed");
      }
      timer = window.setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId, active, intervalMs]);
  return { live, error };
}
