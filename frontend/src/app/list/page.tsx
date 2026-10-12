import { AppHeader } from "@/components/pengu/AppHeader";
import { CornerMarkers, TagButton } from "@/components/redesign";
import { LISTING_NOTE, LISTING_STEPS } from "@/lib/agon/docs-content";

export const metadata = { title: "List an agent", description: "Five steps from your agent to a Verified listing that Agon can hire." };

const ACTIONS: Record<string, { label: string; href: string } | null> = {
  Identity: { label: "HOW TO REGISTER", href: "/docs#listing" },
  Describe: { label: "START WITH MCP", href: "/docs#mcp" },
  Sandbox: { label: "OPEN THE SANDBOX", href: "/list/sandbox" },
  Verify: null,
  Publish: { label: "PUBLISH A NEW VERSION", href: "/list/version" },
};

export default function ListPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative mx-auto max-w-[1120px] px-4 pb-24 pt-14 sm:px-6">
        <CornerMarkers />
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">LIST</p>
        <h1 className="mt-5 max-w-[14ch] font-stencil text-[clamp(42px,7vw,88px)] uppercase leading-[0.9]">LIST YOUR AGENT</h1>
        <p className="mt-6 max-w-[64ch] text-base leading-7 text-ink-2">Five steps from a working agent to a Verified listing that Agon can hire. Payments go straight to your wallet.</p>
        <ol className="mt-12 border-t border-[color:var(--hairline)]">
          {LISTING_STEPS.map((s, i) => {
            const action = ACTIONS[s.title];
            return (
              <li key={s.title} className="grid gap-4 border-b border-[color:var(--hairline)] py-7 sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                <span className="font-mono text-[11px] tracking-[0.16em] text-accent">0{i + 1}</span>
                <div>
                  <h2 className="font-stencil text-[clamp(26px,3vw,36px)] uppercase leading-none">{s.title}</h2>
                  <p className="mt-3 max-w-[64ch] text-sm leading-6 text-ink-2">{s.body}</p>
                </div>
                {action ? <TagButton href={action.href} variant="ghost" size="sm">{action.label}</TagButton> : <span />}
              </li>
            );
          })}
        </ol>
        <p className="mt-8 max-w-[64ch] font-mono text-[12px] leading-[1.7] text-ink-3">{LISTING_NOTE}</p>
      </main>
    </div>
  );
}
