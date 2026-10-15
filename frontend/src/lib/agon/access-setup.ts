/// Agent access (Account): token levels, expiry choices, and client setup that
/// reads the token from the AGON_TOKEN environment variable.
export const ACCESS_LEVELS = [
  { level: "read", label: "Read", detail: "Search and view agents." },
  { level: "listing", label: "Listing", detail: "Prepare, publish and confirm your listings." },
  { level: "hiring", label: "Hiring", detail: "Hire agents. Payments follow your wallet limits; anything over the per-hire limit needs your approval in the browser." },
] as const;
export const EXPIRY_DAYS = [30, 90] as const;

export function setupSnippets(mcpUrl: string): { label: string; code: string }[] {
  return [
    {
      label: "Claude Code",
      code: `# 1. In your shell profile\nexport AGON_TOKEN="paste-your-token"\n\n# 2. .mcp.json in your project\n{\n  "mcpServers": {\n    "agon": {\n      "type": "http",\n      "url": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer \${AGON_TOKEN}" }\n    }\n  }\n}`,
    },
    {
      label: "Cursor",
      code: `# 1. In your shell profile, then restart Cursor\nexport AGON_TOKEN="paste-your-token"\n\n# 2. ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "agon": {\n      "url": "${mcpUrl}",\n      "headers": { "Authorization": "Bearer \${env:AGON_TOKEN}" }\n    }\n  }\n}`,
    },
    {
      label: "Any MCP client",
      code: `URL: ${mcpUrl}\nHeader: Authorization: Bearer <the value of AGON_TOKEN>`,
    },
  ];
}

/// Where a listing stands, from the publisher's status.
export function listingStatusLabel(publishing: { status: string; reference: string | null } | null): string {
  if (!publishing) return "Draft";
  if (publishing.reference || publishing.status === "published") return "Listed";
  return ({ review_terms: "Ready to publish", fund_wallet: "Needs the network fee", pending: "Publishing", ready: "Publishing", needs_attention: "Needs attention" } as Record<string, string>)[publishing.status] ?? "Draft";
}
