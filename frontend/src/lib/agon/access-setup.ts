/// Agent access (Account): one-line MCP setup, plus token levels and token setup
/// for agents that cannot open a browser.
export const ACCESS_LEVELS = [
  { level: "read", label: "Read", detail: "Search and view agents." },
  { level: "listing", label: "Listing", detail: "Prepare, publish and confirm your listings." },
  { level: "hiring", label: "Hiring", detail: "Hire agents. Payments follow your wallet limits; anything over the per-hire limit needs your approval in the browser." },
  { level: "full", label: "Full access", detail: "Search, list your agents and hire. Hiring follows your wallet limits and the per-hire limit." },
  { level: "budget", label: "Spending budget", detail: "Hire inside the limits you set here, with no code for each hire. It cannot list, withdraw or change limits." },
] as const;
export const EXPIRY_DAYS = [7, 30, 90] as const;

/// What a budget token may be given (the server holds the same ceiling: backend access-tokens.ts).
export const BUDGET_DEFAULTS = { perHire: "0.50", daily: "5" } as const;
export const BUDGET_MAX = { perHire: 5, daily: 50 } as const;
export const BUDGET_CATEGORY_OPTIONS = [
  { id: "prediction", label: "Prediction markets" }, { id: "research", label: "Research and web search" }, { id: "market_data", label: "Market and crypto data" },
  { id: "social", label: "News and social" }, { id: "creative", label: "Images and creative" }, { id: "developer", label: "Developer tools" }, { id: "business", label: "Business tools" },
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORY_OPTIONS)[number]["id"];
export type BudgetForm = { perHire: string; daily: string; categories: BudgetCategory[]; allowOutside: boolean };
export type BudgetRequest = { perHire: string; daily: string; categories: BudgetCategory[] | null; allowOutside: boolean };

const amount = (text: string): number | null => (/^\d{1,3}(\.\d{1,6})?$/.test(text.trim()) ? Number(text.trim()) : null);

/// The budget to send, or the plain reason the form cannot be sent. Every category ticked is sent as "any".
export function budgetRequest(form: BudgetForm): { ok: true; budget: BudgetRequest } | { ok: false; message: string } {
  const perHire = amount(form.perHire);
  const daily = amount(form.daily);
  if (perHire === null || daily === null || perHire <= 0) return { ok: false, message: "Enter both limits as USDC amounts, for example 0.50 and 5." };
  if (daily < perHire) return { ok: false, message: "The daily limit cannot be lower than the limit for one hire." };
  if (perHire > BUDGET_MAX.perHire || daily > BUDGET_MAX.daily) return { ok: false, message: `A token can spend at most ${BUDGET_MAX.perHire} USDC a hire and ${BUDGET_MAX.daily} USDC a day.` };
  if (form.categories.length === 0) return { ok: false, message: "Choose at least one category." };
  const all = form.categories.length === BUDGET_CATEGORY_OPTIONS.length;
  return { ok: true, budget: { perHire: form.perHire.trim(), daily: form.daily.trim(), categories: all ? null : [...form.categories], allowOutside: form.allowOutside } };
}

/// One line for the token table: what a budget token may spend and what it has spent today.
export function budgetLine(t: { budget?: { perHire: string; daily: string; categories: string[] | null; allowOutside: boolean } | null; spentToday?: string | null }): string | null {
  if (!t.budget) return null;
  const spent = t.spentToday ?? null;
  return `${t.budget.perHire} a hire, ${spent === null ? "" : `${spent} of `}${t.budget.daily} USDC ${spent === null ? "a day" : "today"}${t.budget.allowOutside ? ", outside services allowed" : ""}`;
}

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
