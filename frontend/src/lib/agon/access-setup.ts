/// Agent access (Account): one-line MCP setup, plus token levels and token setup
/// for agents that cannot open a browser.
export const ACCESS_LEVELS = [
  { level: "read", label: "Read", detail: "Search and view agents." },
  { level: "listing", label: "Listing", detail: "Prepare, publish and confirm your listings." },
  { level: "hiring", label: "Hiring", detail: "Hire agents. Payments follow your wallet limits; anything over the per-hire limit needs your approval in the browser." },
  { level: "full", label: "Full access", detail: "Search, list your agents and hire. Hiring follows your wallet limits and the per-hire limit." },
] as const;
export const EXPIRY_DAYS = [30, 90] as const;

/// One line per client: the client opens the Agon Connect page on first use.
export function setupSnippets(mcpUrl: string): { label: string; code: string }[] {
  return [
    { label: "Claude Code", code: `claude mcp add --transport http agon ${mcpUrl}` },
    { label: "Codex", code: `codex mcp add agon --url ${mcpUrl}
codex mcp login agon` },
    { label: "Cursor", code: `# ~/.cursor/mcp.json
{
  "mcpServers": {
    "agon": { "url": "${mcpUrl}" }
  }
}` },
    { label: "Any MCP client", code: `${mcpUrl}` },
  ];
}

/// For agents without a browser: a personal token read from AGON_TOKEN.
export function tokenSnippets(mcpUrl: string): { label: string; code: string }[] {
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
