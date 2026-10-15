/// The one Agon header (structure spec section 4). Same items signed in or out;
/// signing in adds the Account menu, not more sections.
export type NavItem = { href: string; label: string; exact: boolean };

export const AGON_NAV: readonly NavItem[] = [
  { href: "/", label: "HIRE", exact: true },
  { href: "/agents", label: "AGENTS", exact: false },
  { href: "/arena", label: "ARENA", exact: false },
  { href: "/docs", label: "DOCS", exact: false },
];

