import { nftLink } from "@/lib/arc";

/// Small pill that surfaces the ERC-8004 token id behind an agent. Clicking
/// opens the IdentityRegistry token page on Arcscan, so the operator can see
/// the on-chain NFT that backs their agent. Reused on every agent card.
export function NftBadge({ tokenId, className = "" }: { tokenId: bigint | number; className?: string }) {
  const id = typeof tokenId === "bigint" ? tokenId.toString() : String(tokenId);
  if (!id || id === "0") return null;
  return (
    <a
      href={nftLink(id)}
      target="_blank"
      rel="noreferrer"
      title="view on the Arc explorer"
      className={`inline-flex items-center gap-1.5 rounded-full border border-pengu-blue/20 bg-pengu-blue/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-pengu-blue/85 hover:border-pengu-blue/40 hover:text-pengu-blue ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 2 L20 7 V17 L12 22 L4 17 V7 Z" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      </svg>
      erc-8004 #{id}
    </a>
  );
}
