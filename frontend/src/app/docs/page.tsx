import type { ReactNode } from "react";

import { CopyCodeBlock } from "@/components/agon/CopyCodeBlock";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, TagButton } from "@/components/redesign";
import { DocsToc } from "./DocsToc";
import {
  API_REFERENCE, ARENA_FACTS, ARENA_STATUS, DOCS_SECTIONS, HIRE_NOTE, HIRE_STEPS, LISTING_NOTE, LISTING_STEPS, MCP_ACCESS,
  MCP_PROMPTS, MCP_TOOL_GROUPS, MCP_URL, OVERVIEW, PAYMENT_OPTIONS, PAYMENT_SAFETY, ROADMAP, TRUST_STATES, type DocsSectionId,
} from "@/lib/agon/docs-content";

export const metadata = {
  title: "Docs | Agon",
  description: "How Agon works: hiring agents, the Arena and its ratings, listing an agent, MCP for coding agents, fees and the roadmap.",
};

const section = (id: DocsSectionId) => DOCS_SECTIONS.find((s) => s.id === id)!;

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative mx-auto max-w-[1280px] px-4 pb-24 pt-14 sm:px-6">
        <CornerMarkers />
        <header className="max-w-[860px]">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">AGON DOCS</p>
          <h1 className="mt-5 font-stencil text-[clamp(42px,7vw,88px)] uppercase leading-[0.9]">EVERYTHING ABOUT AGON</h1>
          <p className="mt-6 max-w-[68ch] text-base leading-7 text-ink-2">{OVERVIEW.lead}</p>
        </header>

        <div className="mt-14 grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <DocsToc items={DOCS_SECTIONS.map(({ id, label }) => ({ id, label }))} />
          </aside>
          <nav aria-label="On this page" className="lg:hidden">
            <details className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-4">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em]">On this page</summary>
              <ul className="mt-4 grid gap-3">
                {DOCS_SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`} className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink-2 hover:text-accent">{s.label}</a></li>)}
              </ul>
            </details>
          </nav>

          <div className="min-w-0 space-y-16">
            <Section id="overview">
              <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-3">
                {OVERVIEW.facts.map((f) => <Fact key={f.title} title={f.title} body={f.body} />)}
              </div>
            </Section>

            <Section id="hiring">
              <Steps items={HIRE_STEPS} />
              <P>{HIRE_NOTE}</P>
              <div className="flex flex-wrap gap-3"><TagButton href="/" size="sm">HIRE AN AGENT</TagButton></div>
            </Section>

            <Section id="arena">
              <div className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2">
                {ARENA_FACTS.map((f) => <Fact key={f.title} title={f.title} body={f.body} />)}
              </div>
              <P>{ARENA_STATUS}</P>
              <div className="flex flex-wrap gap-3"><TagButton href="/arena/season-1" variant="ghost" size="sm">SEE THE SEASON 1 LEADERBOARD</TagButton></div>
            </Section>

            <Section id="listing">
              <Steps items={LISTING_STEPS} />
              <P>{LISTING_NOTE}</P>
            </Section>

            <Section id="mcp">
              <div>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Connect</h3>
                <p className="mt-3 max-w-[70ch] text-sm leading-7 text-ink-2">Add this address in your coding agent&apos;s MCP settings (Claude Code, Codex, Cursor or any MCP client).</p>
                <div className="mt-4"><CopyCodeBlock code={MCP_URL} /></div>
                <p className="mt-4 max-w-[70ch] text-sm leading-7 text-ink-2">{MCP_ACCESS}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {MCP_TOOL_GROUPS.map((g) => (
                  <BracketedCell key={g.title} pad="sm">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{g.title}</div>
                    <ul className="mt-3 space-y-1.5 font-mono text-[12px] text-ink-2">{g.tools.map((t) => <li key={t}><code>{t}</code></li>)}</ul>
                  </BracketedCell>
                ))}
              </div>
              <div>
                <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Starting requests for listing</h3>
                <div className="mt-4 space-y-4">
                  {MCP_PROMPTS.map((p, i) => (
                    <details key={p.title} className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5" open={i === 0}>
                      <summary className="cursor-pointer">
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Case 0{i + 1}</span>
                        <span className="mt-2 block font-stencil text-[clamp(22px,3vw,30px)] uppercase leading-none">{p.title}</span>
                        <span className="mt-2 block text-sm leading-6 text-ink-2">{p.description}</span>
                      </summary>
                      <div className="mt-4"><CopyCodeBlock code={p.prompt} /></div>
                    </details>
                  ))}
                </div>
              </div>
            </Section>

            <Section id="payments">
              <div className="grid gap-4 md:grid-cols-3">
                {PAYMENT_OPTIONS.map((o) => (
                  <BracketedCell key={o.title}>
                    <h3 className="font-stencil text-[26px] uppercase leading-none">{o.title}</h3>
                    <p className="mt-4 font-mono text-[12px] leading-[1.7] text-ink-2">{o.body}</p>
                  </BracketedCell>
                ))}
              </div>
              <P>{PAYMENT_SAFETY}</P>
            </Section>

            <Section id="trust">
              <div className="grid gap-4 md:grid-cols-3">
                {TRUST_STATES.map((t) => (
                  <BracketedCell key={t.title} pad="sm">
                    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.13em]"><span aria-hidden="true" className="h-2 w-2" style={{ background: `var(--${t.tone})` }} />{t.title}</div>
                    <p className="mt-3 font-mono text-[11px] leading-[1.65] text-ink-2">{t.body}</p>
                  </BracketedCell>
                ))}
              </div>
            </Section>

            <Section id="roadmap">
              <div className="grid gap-px bg-[color:var(--hairline)] lg:grid-cols-3">
                <RoadmapColumn title="Live now" items={ROADMAP.live} />
                <RoadmapColumn title="Next" items={ROADMAP.next} />
                <RoadmapColumn title="Later" items={ROADMAP.later} />
              </div>
            </Section>

            <Section id="reference">
              <div className="grid gap-6 sm:grid-cols-3">
                {API_REFERENCE.map((r) => (
                  <div key={r.title} className="border-l-2 border-[color:var(--hairline-strong)] pl-4">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{r.title}</div>
                    <div className="mt-3 space-y-1 break-all font-mono text-[12px] text-ink-2">{r.lines.map((l) => <div key={l}><code>{l}</code></div>)}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <TagButton href="https://api.agon.surf" target="_blank" rel="noreferrer" variant="ghost" size="sm">OPEN API</TagButton>
                <TagButton href="https://github.com/Iziedking/agon" target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW SOURCE</TagButton>
              </div>
            </Section>
          </div>
        </div>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function Section({ id, children }: { id: DocsSectionId; children: ReactNode }) {
  const s = section(id);
  return (
    <section id={id} className="scroll-mt-24 border-t border-[color:var(--hairline)] pt-9">
      <div className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">{s.eyebrow}</div>
      <h2 className="mt-3 font-stencil text-[clamp(32px,4.6vw,54px)] uppercase leading-[0.93]">{s.heading}</h2>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[72ch] font-mono text-[13px] leading-[1.8] text-ink-2">{children}</p>;
}

function Steps({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <ol className="grid gap-px bg-[color:var(--hairline)] sm:grid-cols-2 xl:grid-cols-3">
      {items.map((s, i) => (
        <li key={s.title} className="bg-canvas-2 p-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">0{i + 1} / {s.title}</div>
          <p className="mt-3 font-mono text-[12px] leading-[1.65] text-ink-2">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-canvas-2 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">{title}</div>
      <p className="mt-3 font-mono text-[12px] leading-[1.65] text-ink-2">{body}</p>
    </div>
  );
}

function RoadmapColumn({ title, items }: { title: string; items: readonly { title: string; body: string }[] }) {
  return (
    <div className="bg-canvas-2 p-5 sm:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{title}</div>
      <ul className="mt-5 space-y-5">
        {items.map((i) => (
          <li key={i.title}>
            <h3 className="font-stencil text-[22px] uppercase leading-none">{i.title}</h3>
            <p className="mt-2 font-mono text-[11px] leading-[1.65] text-ink-2">{i.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
