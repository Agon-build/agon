type ListingPageItem = { id: string; agentId: string; category: string; firstParty: boolean; status: string; risk: { quarantineReason: string | null } };
type PageResult = { ok: true; value: { items: ListingPageItem[]; nextCursor: string | null } } | { ok: false };

export type LiveListing = { id: string; agentId: string; category: string; firstParty: boolean };

/// Every listed, unquarantined listing. A failed page throws rather than returning a partial list,
/// so the score snapshots keep their last good state instead of dropping agents.
export async function listLiveListings(page: (cursor: string | null) => Promise<PageResult>, maxPages = 50): Promise<LiveListing[]> {
  const out: LiveListing[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i += 1) {
    const result = await page(cursor);
    if (!result.ok) throw new Error("listing page could not be read");
    for (const l of result.value.items) {
      if (l.status === "Listed" && !l.risk.quarantineReason) out.push({ id: l.id, agentId: l.agentId, category: l.category, firstParty: l.firstParty });
    }
    cursor = result.value.nextCursor;
    if (!cursor) break;
  }
  return out;
}
