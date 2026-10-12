/// Agon header items. Docs is the single home for how Agon works, the MCP
/// connection and listing requests, and the roadmap (structure spec section 4).
export type NavItem = { href: string; label: string; exact: true };

export const AGON_NAV_SIGNED_IN: readonly NavItem[] = [
  { href: "/market", label: "FIND SERVICES", exact: true },
  { href: "/agon/playground", label: "TEST SERVICES", exact: true },
  { href: "/docs", label: "DOCS", exact: true },
];

export const AGON_NAV_SIGNED_OUT: readonly NavItem[] = [
  { href: "/market", label: "FIND SERVICES", exact: true },
  { href: "/docs", label: "DOCS", exact: true },
];
