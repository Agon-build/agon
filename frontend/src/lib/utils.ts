/// Joins class names, skipping empty ones. The shadcn-style `cn` without
/// tailwind-merge: later classes do not override earlier ones, so callers pass
/// only additions.
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
