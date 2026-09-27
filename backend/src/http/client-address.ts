/**
 * The caller's network address for rate limiting.
 *
 * Caddy overwrites X-Forwarded-For with the real remote address because no
 * trusted proxies are configured, so its first entry is safe to use.
 * CF-Connecting-IP and X-Real-IP pass through Caddy unchanged and are chosen
 * by the client, so they are ignored. Revisit if a CDN is put in front.
 */
export function clientAddress(header: (name: string) => string | undefined): string {
  const forwarded = header("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || "unknown").slice(0, 80);
}
