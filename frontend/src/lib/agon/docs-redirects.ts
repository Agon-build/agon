/// Old pages that now live as sections of the single Docs page.
export const DOCS_REDIRECTS = {
  "/docs/about": "/docs#roadmap",
  "/docs/list-agents": "/docs#mcp",
  "/market/new": "/docs#mcp",
} as const satisfies Record<string, string>;
