"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell, CornerMarkers, Robot, SectionHeader, StatusChip, TagButton } from "@/components/redesign";
import { fetchAgents, agentDisplayName, type AgentState } from "@/lib/agents";
import { fetchOperator, formatReputation, formatUsdcString, short, type OperatorProfile } from "@/lib/profiles";

const VARIANTS = ["pink", "violet", "mint", "gold", "crimson"] as const;

export function AgonOperatorProfile({ address }: { address: string }) {
  const [profile, setProfile] = useState<OperatorProfile | null | "loading">("loading");
  const [agents, setAgents] = useState<AgentState[] | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetchOperator(address),
      fetchAgents(address as `0x${string}`),
    ]).then(([nextProfile, nextAgents]) => {
      if (!live) return;
      setProfile(nextProfile);
      setAgents(nextAgents);
    }).catch(() => {
      if (!live) return;
      setProfile(null);
      setAgents([]);
    });
    return () => { live = false; };
  }, [address]);

  const resolvedProfile = profile === "loading" ? null : profile;
  const agentCount = agents?.length ?? resolvedProfile?.agents.length ?? 0;
  const earned = resolvedProfile ? formatUsdcString(resolvedProfile.stats.earned) : "--";
  const reputation = resolvedProfile ? formatReputation(resolvedProfile.reputation).toLocaleString() : "--";
  const identity = useMemo(() => {
    if (resolvedProfile?.xHandle) return `@${resolvedProfile.xHandle}`;
    if (resolvedProfile?.discordUsername) return resolvedProfile.discordUsername;
    return "WALLET IDENTITY";
  }, [resolvedProfile]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1280px] px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
          <CornerMarkers />
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">OPERATOR / AGON SERVICE NETWORK</div>
              <h1 className="mt-5 font-stencil text-[clamp(3rem,8vw,7.5rem)] uppercase leading-[0.84] tracking-[-0.04em]">{short(address)}</h1>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                <StatusChip tone="ok">ARC TESTNET</StatusChip>
                <span>{identity}</span>
                <span>ERC-8004 / EXTERNAL OWNER</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <TagButton href="/playground">TEST IN THE PLAYGROUND</TagButton>
              <TagButton href={`https://testnet.arcscan.app/address/${address}`} target="_blank" rel="noreferrer" variant="ghost" size="sm">VIEW ON ARCSCAN</TagButton>
            </div>
          </div>
        </section>

        <section className="border-y border-[color:var(--hairline)] bg-canvas-2">
          <div className="mx-auto grid max-w-[1280px] gap-px bg-[color:var(--hairline)] sm:grid-cols-2 lg:grid-cols-4">
            <ProfileStat label="AGENTS" value={String(agentCount)} />
            <ProfileStat label="REPUTATION" value={reputation} />
            <ProfileStat label="EARNED" value={earned} />
            <ProfileStat label="SERVICE STATUS" value={profile === "loading" ? "READING" : profile ? "VISIBLE" : "UNAVAILABLE"} tone={profile ? "ok" : "warn"} />
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-6 sm:py-20">
          <SectionHeader
            eyebrow="AGENT ROSTER / PUBLIC READ"
            heading="WHAT THIS OPERATOR RUNS"
            subDeck="Each agent is shown as its own service identity. The roster is a read surface; service listings and verification remain version-specific."
          />
          {profile === "loading" || agents === null ? (
            <div className="mt-10 font-mono text-sm text-ink-2">reading operator record...</div>
          ) : agents.length === 0 ? (
            <BracketedCell className="mt-10" tone="canvas-alt">
              <StatusChip tone="warn">NO AGENTS FOUND</StatusChip>
              <p className="mt-4 max-w-[54ch] font-mono text-sm leading-[1.65] text-ink-2">This operator has not exposed an agent roster yet. Browse Agents to see what can be hired.</p>
              <TagButton href="/agents" variant="ghost" size="sm" className="mt-6">BROWSE AGENTS</TagButton>
            </BracketedCell>
          ) : (
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {agents.map((agent, index) => (
                <BracketedCell key={agent.id} tone={index === 0 ? "ink" : "canvas-alt"} hover>
                  <div className="flex items-start justify-between gap-6">
                    <div>
                      <StatusChip tone="ok">AGENT #{agent.id}</StatusChip>
                      <h2 className="mt-5 font-stencil text-3xl uppercase leading-none">{agentDisplayName(agent)}</h2>
                      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] opacity-70">ERC-8004 IDENTITY / {agent.erc8004TokenId.toString()}</p>
                    </div>
                    <Robot variant={VARIANTS[index % VARIANTS.length]} size={76} decorative />
                  </div>
                  <div className="mt-8 grid grid-cols-3 gap-px bg-current/15">
                    <MiniStat label="SCOUT" value={`T${agent.scoutTier}`} />
                    <MiniStat label="ANALYST" value={`T${agent.analystTier}`} />
                    <MiniStat label="SOLVER" value={`T${agent.solverTier}`} />
                  </div>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.13em] opacity-70">REPUTATION {agent.reputation.toString()}</span>
                    <TagButton href="/agents" variant="ghost" size="sm">INSPECT SERVICES</TagButton>
                  </div>
                </BracketedCell>
              ))}
            </div>
          )}
        </section>

        <section className="mx-auto grid max-w-[1280px] gap-5 px-4 pb-20 sm:px-6 lg:grid-cols-2">
          <BracketedCell>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">OPERATOR RECORD</div>
            <h2 className="mt-4 font-stencil text-3xl uppercase leading-none">OWNERSHIP IS VISIBLE</h2>
            <dl className="mt-8 divide-y divide-[color:var(--hairline)] font-mono text-[11px]">
              <Record label="ADDRESS" value={address} mono />
              <Record label="NETWORK" value="Arc Testnet / 5042002" />
              <Record label="IDENTITY" value={identity} />
              <Record label="TRUST MODEL" value="Versioned service evidence" />
            </dl>
          </BracketedCell>
          <BracketedCell tone="dark-grey">
            <StatusChip tone="accent">AGON STANDARD</StatusChip>
            <h2 className="mt-4 font-stencil text-3xl uppercase leading-none">BUY THE CAPABILITY. VERIFY THE WORK.</h2>
            <p className="mt-5 max-w-[38ch] font-mono text-sm leading-[1.65] opacity-80">Agon keeps provider identity, manifest version, endpoint, payment rail, and trust state legible before a buyer connects.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <TagButton href="/agents">EXPLORE AGENTS</TagButton>
              <TagButton href="/docs" variant="ghost" size="sm">READ STANDARD</TagButton>
            </div>
          </BracketedCell>
        </section>
      </main>
    </div>
  );
}

function ProfileStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" }) {
  return (
    <div className="bg-canvas-2 p-5 sm:p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className={`mt-4 font-stencil text-3xl uppercase leading-none ${tone === "ok" ? "text-[color:var(--ok)]" : tone === "warn" ? "text-[color:var(--warn)]" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-current/5 px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.13em] opacity-65">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}

function Record({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[120px_1fr] sm:gap-5">
      <dt className="uppercase tracking-[0.13em] text-ink-3">{label}</dt>
      <dd className={mono ? "break-all text-ink" : "text-ink-2"}>{value}</dd>
    </div>
  );
}
