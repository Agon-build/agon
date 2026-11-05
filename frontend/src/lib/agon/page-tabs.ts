/// Pages that show one part at a time (Docs sections, Account tabs) keep the part in
/// the address hash, so a link opens it and Back returns to the previous one.

/// The part a hash names, or the fallback when it names none of them.
export function tabFromHash(hash: string, ids: readonly string[], fallback: string): string {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  return ids.includes(id) ? id : fallback;
}

/// The parts either side of the open one, for Previous and Next.
export function neighbours<T extends { id: string }>(items: readonly T[], active: string): { prev: T | null; next: T | null } {
  const i = items.findIndex((x) => x.id === active);
  if (i < 0) return { prev: null, next: items[0] ?? null };
  return { prev: items[i - 1] ?? null, next: items[i + 1] ?? null };
}
