import { shortHash } from "@/lib/agon/stage-view";

export function TxLink({ url }: { url: string | null }) {
  if (!url) return <span className="font-mono text-[11px] text-ink-3">Awaiting transaction</span>;
  const hash = url.split("/").pop() ?? url;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-mono text-[11px] text-ink-2 underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent focus-visible:text-accent">
      {shortHash(hash)}<span className="sr-only"> (opens the Arc explorer)</span><span aria-hidden className="ml-1">↗</span>
    </a>
  );
}
