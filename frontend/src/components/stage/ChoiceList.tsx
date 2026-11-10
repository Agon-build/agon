"use client";
import { useState } from "react";

import { bestChoice, groupHeading, proofLines } from "@/lib/agon/choice-view";
import { moneyLine } from "@/lib/agon/hire-layout";
import { CHOICES_COPY, RECENTLY_FAILED_MARK } from "@/lib/agon/stage-copy";
import type { ChoiceGroup, ChoiceGroups, HireCategory, HireCategoryId, RoutePick, RouteSourceStatus } from "@/lib/agon/stage-types";

const SHOWN = 3;
const GROUP_NOTE: Record<ChoiceGroup, string> = {
  ranked: "scored by Arena, Playground and ratings",
  new: "hireable, no score yet",
  outside: "from Circle's Agent Marketplace, not ranked",
};

/// The person's choices for one request: Agon agents ranked by proof, new Agon agents,
/// then outside services, which Agon never ranks. Choosing one goes on to its exact price.
export function ChoiceList({ category, categories, groups, sources, busy, selected = null, onChoose, onCategory, onCancel }: {
  category: HireCategoryId;
  categories: HireCategory[];
  groups: ChoiceGroups;
  sources: RouteSourceStatus[];
  busy: boolean;
  selected?: string | null;
  onChoose: (p: RoutePick) => void;
  onCategory: (id: HireCategoryId) => void;
  onCancel: () => void;
}) {
  const circleDown = sources.some((s) => s.id === "circle" && s.status === "unavailable");
  const empty = groups.ranked.length + groups.fresh.length + groups.outside.length === 0;
  const best = bestChoice(groups);
  const bestName = best ? [...groups.ranked, ...groups.fresh, ...groups.outside].find((p) => p.reference === best.reference)?.name ?? null : null;
  return (
    <section aria-label="Choices" className="stage-print">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {categories.length > 0 ? (
          <label className="flex items-center gap-2">
            <span className="sr-only">{CHOICES_COPY.change}</span>
            <select
              value={category} disabled={busy} onChange={(e) => onCategory(e.target.value as HireCategoryId)}
              className="min-h-11 max-w-[14rem] border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 text-sm text-ink-2 focus:border-accent focus:outline-none"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        ) : null}
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 border border-[color:var(--hairline-strong)] px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:border-accent hover:text-accent disabled:opacity-60">
          Edit question
        </button>
      </div>

      {empty ? (
        <div className="mt-6 border border-[color:var(--hairline-strong)] bg-canvas-2 p-6">
          <p className="text-base leading-7 text-ink">{CHOICES_COPY.empty}</p>
          {circleDown ? <p className="mt-2 text-sm text-ink-2">{CHOICES_COPY.circleDown}</p> : null}
          <a href="/docs#mcp" className="mt-4 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink underline underline-offset-4 hover:text-accent">{CHOICES_COPY.listOne}</a>
        </div>
      ) : (
        <div role="radiogroup" aria-label="Pick an agent">
          {best && bestName ? (
            <p className="mt-6 border-l-2 border-accent pl-3 text-sm leading-6 text-ink">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Agon's pick</span>
              <span className="ml-2 font-medium">{bestName}</span>
              <span className="ml-2 text-ink-2">{best.why}.</span>
            </p>
          ) : null}
          <Group group="ranked" items={groups.ranked} busy={busy} selected={selected} onChoose={onChoose} best={best?.reference ?? null} />
          <Group group="new" items={groups.fresh} busy={busy} selected={selected} onChoose={onChoose} best={best?.reference ?? null} />
          <Group group="outside" items={groups.outside} busy={busy} selected={selected} onChoose={onChoose} down={circleDown} best={best?.reference ?? null} />
        </div>
      )}
    </section>
  );
}

function Group({ group, items, busy, selected, onChoose, down, best }: { group: ChoiceGroup; items: RoutePick[]; busy: boolean; selected: string | null; onChoose: (p: RoutePick) => void; down?: boolean; best: string | null }) {
  const [all, setAll] = useState(false);
  if (items.length === 0 && !down) return null;
  // The chosen card stays in view even when it sits past the first three.
  const shown = all ? items : items.filter((p, i) => i < SHOWN || p.reference === selected);
  return (
    <div className="mt-6">
      <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden className={`inline-block size-2 ${group === "ranked" ? "bg-accent" : "bg-ink-3"}`} />
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink">{groupHeading(group)}</span>
        <span className="font-mono text-[10px] text-ink-3">{GROUP_NOTE[group]}</span>
      </h3>
      {down && items.length === 0 ? <p className="mt-2 text-sm text-ink-2">{CHOICES_COPY.circleDown}</p> : null}
      <ul className="mt-3 grid gap-2">
        {shown.map((p) => <ChoiceCard key={p.reference} pick={p} busy={busy} checked={p.reference === selected} onChoose={onChoose} best={p.reference === best} />)}
      </ul>
      {items.length > shown.length && !all ? (
        <button type="button" onClick={() => setAll(true)} className="mt-2 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">
          Show {items.length - shown.length} more
        </button>
      ) : null}
    </div>
  );
}

function badge(pick: RoutePick): string {
  if (pick.group === "outside" || pick.source === "circle") return pick.provider || "Circle";
  return pick.rating.tier === "listed" || pick.rating.tier === "unrated" ? "Listed on Agon" : "Verified on Agon";
}

function under(pick: RoutePick): string {
  if (pick.recentlyFailed) return RECENTLY_FAILED_MARK;
  if (pick.group === "outside" || pick.source === "circle") return moneyLine(pick.network) ?? "";
  const score = pick.rating.proof?.score ?? null;
  return score !== null ? `Agon score ${Math.round(score * 10) / 10}` : "Not scored yet";
}

function ChoiceCard({ pick, busy, checked, onChoose, best }: { pick: RoutePick; busy: boolean; checked: boolean; onChoose: (p: RoutePick) => void; best: boolean }) {
  const lines = pick.group === "ranked" ? proofLines(pick).filter((l) => !l.startsWith("Agon score")) : [];
  return (
    <li>
      <button
        type="button" role="radio" aria-checked={checked} disabled={busy} onClick={() => onChoose(pick)}
        className={`grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border p-4 text-left transition-colors duration-150 disabled:opacity-60 motion-reduce:transition-none ${checked ? "border-accent bg-canvas-3" : "border-[color:var(--hairline-strong)] bg-canvas-2 hover:border-ink-3"}`}
      >
        <span aria-hidden className={`mt-1.5 inline-flex size-3.5 items-center justify-center rounded-full border ${checked ? "border-accent" : "border-ink-3"}`}>
          {checked ? <span className="size-2 rounded-full bg-accent" /> : null}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="break-words text-base font-medium leading-6 text-ink">{pick.name}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{badge(pick)}</span>
            {best ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">Agon's pick</span> : null}
          </span>
          {pick.description ? <span className="mt-1 line-clamp-2 block text-sm leading-6 text-ink-2">{pick.description}</span> : null}
          {lines.length > 0 ? <span className="mt-1 block font-mono text-[10px] tabular-nums text-ink-3">{lines.join(" · ")}</span> : null}
        </span>
        <span className="text-right">
          <span className="block font-mono text-sm tabular-nums text-ink">{pick.price} USDC</span>
          <span className="mt-1 block font-mono text-[10px] text-ink-3">{under(pick)}</span>
        </span>
      </button>
    </li>
  );
}
