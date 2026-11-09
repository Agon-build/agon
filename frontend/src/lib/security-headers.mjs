// Browser protections for every page. Agon pages are never meant to be framed,
// which also protects the sign-in, CLI approval and admin screens from clickjacking.
//
// Scripts (audit F1, 2026-11-09): only this site's own scripts run. Every wallet
// SDK is bundled into those scripts, and the site loads no third-party script.
// 'unsafe-inline' stays because Next.js writes its page data and the theme
// script inline; the next step is a per-request nonce, which makes every page
// dynamic and needs a browser pass over the wallet flows first.
// Only scripts are restricted here: API, RPC, wallet sockets, fonts and images
// keep loading from wherever they do today.
const CSP = [
  "script-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

/** @type {{ key: string; value: string }[]} */
export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
