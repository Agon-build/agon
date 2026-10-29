"use client";
import { useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { ratedLine, refusalText, starsLabel } from "@/lib/agon/job-rating-view";
import { COMMENT_MAX, getJobRating, rateJob, type RatingStatus } from "@/lib/agon/ratings-api";

/// Under a delivered job's receipt: the person who paid rates it once, 1 to 5 stars.
/// Hidden for anyone else and for jobs that cannot be rated.
export function RatePanel({ jobId, agent }: { jobId: string; agent: string | null }) {
  const [status, setStatus] = useState<RatingStatus | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getJobRating(jobId).then((s) => { if (live) setStatus(s); }).catch(() => { if (live) setStatus(null); });
    return () => { live = false; };
  }, [jobId]);

  async function send() {
    if (stars < 1) return;
    setSending(true);
    setError(null);
    try {
      const out = await rateJob(jobId, stars, comment);
      setStatus({ canRate: false, reason: "already_rated", rating: out.rating });
    } catch {
      setError("The rating did not save. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (!status) return null;
  if (!status.canRate) {
    if (status.rating) {
      return (
        <section aria-labelledby="rate-heading" className="mt-12 border-t border-[color:var(--hairline-strong)] pt-6">
          <h2 id="rate-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Your rating</h2>
          <p className="mt-3 font-mono text-[13px] text-ink">{ratedLine(status.rating.stars, status.rating.createdAt)}</p>
          {status.rating.comment ? <p className="mt-2 max-w-[60ch] text-sm leading-6 text-ink-2">{status.rating.comment}</p> : null}
        </section>
      );
    }
    const text = refusalText(status.reason);
    return text ? <p className="mt-12 border-t border-[color:var(--hairline-strong)] pt-6 text-sm text-ink-3">{text}</p> : null;
  }

  return (
    <section aria-labelledby="rate-heading" className="mt-12 border-t border-[color:var(--hairline-strong)] pt-6">
      <h2 id="rate-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Rate this job</h2>
      <p className="mt-3 text-sm text-ink-2">How well did {agent ?? "the agent"} do the job?</p>
      <div role="radiogroup" aria-label="Stars" className="mt-4 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={starsLabel(n)} onClick={() => setStars(n)}
            className={`min-h-11 min-w-11 border px-3 font-mono text-[15px] transition-colors duration-150 motion-reduce:transition-none ${n <= stars ? "border-accent bg-accent text-[color:var(--accent-ink)]" : "border-[color:var(--hairline-strong)] text-ink-2 hover:text-ink"}`}>
            {n} ★
          </button>
        ))}
      </div>
      <label className="mt-5 block max-w-[60ch]">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Comment (optional)</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))} rows={3} maxLength={COMMENT_MAX}
          className="mt-2 w-full resize-y border border-[color:var(--hairline-strong)] bg-canvas p-3 text-sm text-ink focus:border-accent focus:outline-none" />
        <span className="mt-1 block text-right font-mono text-[10px] text-ink-3">{comment.length}/{COMMENT_MAX}</span>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <TagButton onClick={() => void send()} disabled={stars < 1 || sending}>{sending ? "SAVING…" : "SAVE RATING"}</TagButton>
        <p aria-live="polite" className="font-mono text-[11px] text-ink-2">{error ?? (stars > 0 ? starsLabel(stars) : "Pick 1 to 5 stars")}</p>
      </div>
    </section>
  );
}
