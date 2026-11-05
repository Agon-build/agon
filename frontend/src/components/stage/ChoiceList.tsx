"use client";
import { useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { groupHeading, networkWords, proofLines } from "@/lib/agon/choice-view";
import { CHOICES_COPY } from "@/lib/agon/stage-copy";
import type { ChoiceGroup, ChoiceGroups, HireCategory, HireCategoryId, RoutePick, RouteSourceStatus } from "@/lib/agon/stage-types";

const SHOWN = 3;

/// The person's choices for one request: Agon agents ranked by proof, new Agon agents,
/// then outside services, which Agon never ranks. Choosing one goes on to its exact price.
export function ChoiceList({ category, categories, groups, sources, busy, onChoose, onCategory, onCancel }: {
  category: HireCategoryId;
  categories: HireCategory[];
  groups: ChoiceGroups;
  sources: RouteSourceStatus[];
  busy: boolean;
  onChoose: (p: RoutePick) => void;
  onCategory: (id: HireCategoryId) => void;
  onCancel: () => void;
}) {
  const circleDown = sources.some((s) => s.id === "circle" && s.status === "unavailable");
  const empty = groups.ranked.length + groups.fresh.length + groups.outside.length === 0;
  const label = categories.find((c) => c.id === category)?.label ?? null;
  return (
    <section aria-labelledby="choices-heading" className="stage-print">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline-strong)] pb-4">
        <h2 id="choices-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{label ?? "Choices"}</h2>
        {categories.length > 0 ? (
          <label className="flex min-h-11 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            <span>{CHOICES_COPY.change}</span>
            <select
              value={category} disabled={busy} onChange={(e) => onCategory(e.target.value as HireCategoryId)}
              className="min-h-11 max-w-[14rem] border border-[color:var(--hairline-strong)] bg-canvas px-2 font-mono text-[11px] normal-case tracking-normal text-ink focus:border-accent focus:outline-none"
            >
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {empty ? (
        <div className="border-b border-[color:var(--hairline)] py-8">
          <p className="text-base leading-7 text-ink">{CHOICES_COPY.empty}</p>
          {circleDown ? <p className="mt-2 text-sm text-ink-2">{CHOICES_COPY.circleDown}</p> : null}
          <a href="/docs#mcp" className="mt-4 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink underline underline-offset-4 hover:text-accent">{CHOICES_COPY.listOne}</a>
        </div>
      ) : (
        <>
          <Group group="ranked" items={groups.ranked} busy={busy} onChoose={onChoose} />
          <Group group="new" items={groups.fresh} busy={busy} onChoose={onChoose} note={CHOICES_COPY.newNote} />
          <Group group="outside" items={groups.outside} busy={busy} onChoose={onChoose} note={CHOICES_COPY.outsideNote} down={circleDown} />
        </>
      )}
      <div className="mt-6"><TagButton variant="ghost" onClick={onCancel} disabled={busy}>Start again</TagButton></div>
    </section>
  );
}

function Group({ group, items, busy, onChoose, note, down }: { group: ChoiceGroup; items: RoutePick[]; busy: boolean; onChoose: (p: RoutePick) => void; note?: string; down?: boolean }) {
  const [all, setAll] = useState(false);
  if (items.length === 0 && !down) return null;
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <div className="mt-8">
      <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-2">{groupHeading(group)}</h3>
      {note && items.length > 0 ? <p className="mt-1 text-xs leading-5 text-ink-3">{note}</p> : null}
      {down && items.length === 0 ? <p className="mt-2 text-sm text-ink-2">{CHOICES_COPY.circleDown}</p> : null}
      <ul className="mt-3 grid gap-3">
        {shown.map((p) => <ChoiceCard key={p.reference} pick={p} busy={busy} onChoose={onChoose} />)}
      </ul>
      {items.length > SHOWN && !all ? (
        <button type="button" onClick={() => setAll(true)} className="mt-3 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">
          Show {items.length - SHOWN} more
        </button>
      ) : null}
    </div>
  );
}

function ChoiceCard({ pick, busy, onChoose }: { pick: RoutePick; busy: boolean; onChoose: (p: RoutePick) => void }) {
  const lines = proofLines(pick);
  const outside = pick.group === "outside";
  return (
    <li className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-base leading-6 text-ink">{pick.name}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{outside ? pick.provider : "Agon"}</p>
        </div>
        <p className="font-mono text-sm tabular-nums text-ink">{pick.total} USDC</p>
      </div>
      {pick.description ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-ink-2">{pick.description}</p> : null}
      {lines.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-ink-2">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {outside ? <span className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">Outside market</span> : null}
          <span className="border border-[color:var(--hairline)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{networkWords(pick)}</span>
        </div>
        <TagButton onClick={() => onChoose(pick)} disabled={busy}>Choose</TagButton>
      </div>
    </li>
  );
}
