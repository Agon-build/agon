"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { AgonOperatorProfile } from "@/components/agon/AgonOperatorProfile";
import { BracketedCell, CornerMarkers, Robot } from "@/components/redesign";
import { SkinCropModal } from "@/components/redesign/SkinCropModal";
import { AgentTraits } from "@/components/pengu/AgentTraits";
import { NftBadge } from "@/components/pengu/NftBadge";
import { EXPLORER } from "@/lib/arc";
import {
  CONTEST_TYPES,
  agentDisplayName,
  fetchAgents,
  resolveActiveAgent,
  setActiveAgentId,
  tierOf,
  type AgentState,
} from "@/lib/agents";
import { AgentAvatar } from "@/components/pengu/AgentAvatar";
import {
  clearAgentSkin,
  fetchOperator,
  getSetting,
  saveAgentDisplayMode,
  saveAgentName,
  saveAgentSkin,
  saveIdentityMode,
  setSetting,
  short,
  type OperatorProfile,
  type SettingKey,
} from "@/lib/profiles";
import { enrollPasskey, fetchPasskeys, type PasskeyRecord } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";

/// /operators/[address]. The profile is for who you
/// are and how things look. Stats live on /dashboard.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

export default function OperatorPage() {
  const params = useParams();
  const address = (Array.isArray(params.address) ? params.address[0] : params.address) ?? "";
  if (IS_AGON_DEPLOYMENT) return <AgonOperatorProfile address={address} />;

  return <LegacyOperatorPage address={address} />;
}

function LegacyOperatorPage({ address }: { address: string }) {
  // Read the signed-in operator address from the shared auth context so
  // Circle email users (who have a SIWE session but no wagmi connection)
  // see their own profile as "isMe". wagmi's useAccount returns undefined
  // for them and would hide SOCIALS + SETTINGS.
  const { me: auth } = useAuth();
  const meAddress = auth?.address ?? null;
  const isMe = !!meAddress && !!address && meAddress.toLowerCase() === address.toLowerCase();
  const isEmailUser = auth?.walletKind === "circle";

  const [profile, setProfile] = useState<OperatorProfile | null | "loading">("loading");
  const [agents, setAgents] = useState<AgentState[] | undefined>(undefined);

  useEffect(() => {
    if (!address) return;
    let live = true;
    setProfile("loading");
    setAgents(undefined);
    fetchOperator(address)
      .then((p) => { if (live) setProfile(p); })
      .catch(() => { if (live) setProfile(null); });
    fetchAgents(address as `0x${string}`)
      .then((list) => { if (live) setAgents(list); })
      .catch(() => { if (live) setAgents([]); });
    return () => { live = false; };
  }, [address]);

  async function unbindX() {
    try {
      await fetch(`${AUTH_URL}/auth/x/unbind`, { method: "POST", credentials: "include" });
      const next = await fetchOperator(address);
      setProfile(next);
    } catch {/* silent */}
  }

  // Header identity resolves the operator-level choice (identity_mode): 'auto'
  // prefers X, then Discord, then the first agent's custom skin, then the
  // masked wallet. A pinned mode resolves just its source. This is the same
  // rule the leaderboard row uses, so the two always agree.
  const primaryAgent = Array.isArray(agents) ? agents[0] ?? null : null;
  const headerXHandle = profile !== "loading" ? profile?.xHandle ?? null : null;
  const headerDiscord = profile !== "loading" ? profile?.discordUsername ?? null : null;
  const headerDiscordAvatar = profile !== "loading" ? profile?.discordAvatar ?? null : null;
  const identityMode = profile !== "loading" ? profile?.identityMode ?? "auto" : "auto";
  let headerAvatar: string | null = null;
  let headerLabel: string | null = null;
  {
    const order = identityMode === "auto" ? (["x", "discord", "custom"] as const) : ([identityMode] as const);
    for (const k of order) {
      if (k === "x" && headerXHandle) { headerAvatar = `https://unavatar.io/x/${headerXHandle}`; headerLabel = `@${headerXHandle}`; break; }
      if (k === "discord" && headerDiscord) { headerAvatar = headerDiscordAvatar; headerLabel = headerDiscord; break; }
      if (k === "custom" && primaryAgent?.skin) { headerAvatar = primaryAgent.skin; headerLabel = primaryAgent.nickname ?? null; break; }
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-4 sm:px-6 pt-16">
        <CornerMarkers />
        <div className="flex flex-wrap items-center gap-5">
          <span
            className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas-2"
            style={{ borderRadius: "50%" }}
          >
            {headerAvatar ? (
              <img
                src={headerAvatar}
                alt={primaryAgent?.nickname ?? `agent #${primaryAgent?.id ?? ""}`}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <Robot variant="pink" size={40} decorative />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> OPERATOR
            </div>
            <h1
              className="mt-2 font-stencil uppercase text-ink"
              style={{ fontSize: "clamp(36px, 5vw, 64px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}
            >
              {short(address)}
            </h1>
            {headerLabel ? (
              <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
                {headerLabel}
              </p>
            ) : null}
          </div>
          <a
            href={`${EXPLORER}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink"
          >
            EXPLORER ↗
          </a>
        </div>

        {profile === "loading" ? (
          <p className="mt-8 font-mono text-sm text-ink-2">reading the profile…</p>
        ) : null}
      </section>

      {/* IDENTITY: how this operator shows on the leaderboard and profile
          header. isMe only; one operator-level choice, separate from how each
          agent appears inside a live event. */}
      {isMe && profile !== "loading" ? (
        <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pt-12">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> IDENTITY
          </div>
          <IdentityPicker
            current={identityMode}
            xLinked={!!headerXHandle}
            discordLinked={!!headerDiscord}
            customLinked={!!primaryAgent?.skin}
            onChanged={async () => setProfile(await fetchOperator(address))}
          />
        </section>
      ) : null}

      {/* AGENTS */}
      <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pt-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> AGENTS
          </span>
          {isMe ? (
            <a href="/workshop" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
              MANAGE IN WORKSHOP →
            </a>
          ) : null}
        </div>

        {agents === undefined ? (
          <p className="font-mono text-sm text-ink-2">reading agents from arc…</p>
        ) : agents.length === 0 ? (
          <p className="font-mono text-sm text-ink-2">no agents claimed yet.</p>
        ) : isMe ? (
          // Owner view: a picker that defaults to the active agent and shows
          // only that agent's card, so a multi-agent operator isn't a wall of
          // cards (especially on mobile).
          <AgentManager
            agents={agents}
            ownerAddress={address}
            xLinked={profile !== "loading" && !!profile?.xHandle}
            discordLinked={profile !== "loading" && !!profile?.discordUsername}
          />
        ) : primaryAgent ? (
          // Public view: just the operator's primary agent, no loadout. The full
          // roster and traits are private to the owner's workshop.
          <div className="max-w-[640px]">
            <PublicAgentCard agent={primaryAgent} />
          </div>
        ) : null}
      </section>

      {/* SOCIALS. Public viewers only see what's linked; owner sees the full
          card with link / unbind actions and unlinked rows. */}
      {isMe ? (
        <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pt-12">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> SOCIALS
          </div>
          <BracketedCell pad="sm">
            <div className="flex flex-col">
              <SocialRow
                label="X"
                handle={profile !== "loading" && profile?.xHandle ? `@${profile.xHandle}` : null}
                avatarUrl={profile !== "loading" && profile?.xHandle ? `https://unavatar.io/x/${profile.xHandle}` : undefined}
                hint="Connect your X account."
                isMe={isMe}
                connectHref={`${AUTH_URL}/auth/x/start`}
                connectLabel="CONNECT X"
                onUnbind={unbindX}
              />
              <TelegramRow
                isMe={isMe}
                handle={profile !== "loading" ? profile?.telegramUsername ?? null : null}
                telegramId={profile !== "loading" ? profile?.telegramId ?? null : null}
                // Telegram avatars can't be resolved from a username (unavatar
                // returns a blank circle), so we only use the photo captured at
                // link time. TelegramRow backfills it via the Bot API when it's
                // missing, and shows a clean initial otherwise.
                avatarUrl={profile !== "loading" ? profile?.telegramAvatar ?? null : null}
                onRefreshed={async () => setProfile(await fetchOperator(address))}
                onUnbind={async () => {
                  await fetch(`${AUTH_URL}/auth/telegram/unbind`, { method: "POST", credentials: "include" });
                  setProfile(await fetchOperator(address));
                }}
              />
              <DiscordRow
                isMe={isMe}
                handle={profile !== "loading" ? profile?.discordUsername ?? null : null}
                avatarUrl={profile !== "loading" ? profile?.discordAvatar ?? null : null}
                onUnbind={async () => {
                  await fetch(`${AUTH_URL}/auth/discord/unbind`, { method: "POST", credentials: "include" });
                  setProfile(await fetchOperator(address));
                }}
              />
            </div>
          </BracketedCell>
        </section>
      ) : (
        <PublicSocialStrip
          xHandle={profile !== "loading" ? profile?.xHandle ?? null : null}
          telegramUsername={profile !== "loading" ? profile?.telegramUsername ?? null : null}
          discordUsername={profile !== "loading" ? profile?.discordUsername ?? null : null}
        />
      )}

      {/* SETTINGS: isMe only. */}
      {isMe ? (
        <section className="mx-auto max-w-[1600px] px-4 sm:px-6 py-12 pb-16">
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> SETTINGS
          </div>
          <BracketedCell pad="sm">
            <div className="flex flex-col">
              {isEmailUser ? <PasskeysRow /> : null}
              <SettingRow
                k="theme"
                label="THEME"
                hint="Select your preferred theme."
                options={[
                  { value: "auto", label: "DAYLIGHT" },
                  { value: "light", label: "LIGHT" },
                  { value: "dark", label: "DARK" },
                ]}
                fallback="dark"
              />
              <SettingRow
                k="lang"
                label="LANGUAGE"
                hint="more languages are coming"
                options={[
                  { value: "en", label: "ENGLISH" },
                  { value: "es", label: "SPANISH (SOON)", disabled: true },
                  { value: "ja", label: "JAPANESE (SOON)", disabled: true },
                ]}
                fallback="en"
              />
              <ToggleRow
                k="muted"
                label="MUTE SOUND EFFECTS"
                hint="sound effects are coming; the toggle remembers your choice."
              />
            </div>
          </BracketedCell>
        </section>
      ) : null}

      <Footer />
    </div>
  );
}

/// Operator-level identity picker. Sets what shows on the leaderboard row and
/// the profile header: AUTO (X, then Discord, then wallet), or pinned to a
/// single source. Disabled options point at what to link first. Optimistic,
/// reverts on error.
function IdentityPicker({
  current,
  xLinked,
  discordLinked,
  customLinked,
  onChanged,
}: {
  current: "auto" | "x" | "discord" | "custom" | "wallet";
  xLinked: boolean;
  discordLinked: boolean;
  customLinked: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMode(current), [current]);

  async function pick(next: typeof mode) {
    if (next === mode || busy) return;
    const prev = mode;
    setBusy(true);
    setError(null);
    setMode(next); // optimistic
    const res = await saveIdentityMode(next);
    setBusy(false);
    if (!res.ok) {
      setMode(prev);
      setError(res.error);
      return;
    }
    await onChanged();
  }

  const opts = [
    { k: "auto" as const, label: "AUTO", enabled: true, hint: "" },
    { k: "x" as const, label: "X PROFILE", enabled: xLinked, hint: "link your X first" },
    { k: "discord" as const, label: "DISCORD", enabled: discordLinked, hint: "link your discord first" },
    { k: "custom" as const, label: "CUSTOM", enabled: customLinked, hint: "upload an agent skin first" },
    { k: "wallet" as const, label: "WALLET", enabled: true, hint: "" },
  ];

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">SHOWN AS</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {opts.map((opt) => (
          <button
            key={opt.k}
            onClick={() => opt.enabled && void pick(opt.k)}
            disabled={!opt.enabled || busy}
            title={!opt.enabled ? opt.hint : undefined}
            className={
              mode === opt.k
                ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                : opt.enabled
                  ? "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink disabled:opacity-60"
                  : "cursor-not-allowed border border-[color:var(--hairline)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 opacity-50"
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-ink-3">
        auto shows your X, then discord, then your wallet. this is the name and picture on the leaderboard and at the top of your profile.
      </p>
      {error ? <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{error}</p> : null}
    </BracketedCell>
  );
}

/// One social row inside the BracketedCell. Used directly for X. Telegram and
/// Discord wrap their own rows because of the widget/OAuth specifics.
function SocialRow({
  label,
  handle,
  hint,
  isMe,
  connectHref,
  connectLabel,
  onUnbind,
  avatarUrl,
}: {
  label: string;
  handle: string | null;
  hint: string;
  isMe: boolean;
  connectHref: string;
  connectLabel?: string;
  onUnbind: () => void | Promise<void>;
  avatarUrl?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        {handle && avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            decoding="async"
            className="h-9 w-9 flex-none rounded-full bg-canvas-3 object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
          <div className="mt-1 font-mono text-sm text-ink">{handle ?? "NOT LINKED"}</div>
          {!handle ? (
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</div>
          ) : null}
        </div>
      </div>
      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : (
          <a
            href={connectHref}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            {connectLabel ?? "CONNECT"} <span aria-hidden>→</span>
          </a>
        )
      ) : null}
    </div>
  );
}

/// Slim agent card for the public view: just identity (avatar + name + tiers).
/// The loadout (traits) is private to the owner's workshop, so it isn't shown
/// here.
function PublicAgentCard({ agent }: { agent: AgentState }) {
  const display = (agent.nickname ?? "").trim();
  return (
    <BracketedCell className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden bg-canvas-3">
          {agent.skin ? (
            <img
              src={agent.skin}
              alt={display || `agent #${agent.id}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <Robot variant="pink" size={42} decorative />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-stencil uppercase text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {display ? display : `AGENT #${agent.id}`}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-3">
            {CONTEST_TYPES.map((t) => `${t.toUpperCase()} T${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
      </div>
    </BracketedCell>
  );
}

/// Read-only socials strip rendered on the public view. Only shows accounts
/// that are actually linked. No placeholder "NOT LINKED" rows.
function PublicSocialStrip({
  xHandle,
  telegramUsername,
  discordUsername,
}: {
  xHandle: string | null;
  telegramUsername: string | null;
  discordUsername: string | null;
}) {
  const linked: Array<{ label: string; handle: string; href?: string }> = [];
  if (xHandle) linked.push({ label: "X", handle: `@${xHandle}`, href: `https://x.com/${xHandle}` });
  if (telegramUsername) linked.push({ label: "TELEGRAM", handle: `@${telegramUsername}`, href: `https://t.me/${telegramUsername}` });
  if (discordUsername) linked.push({ label: "DISCORD", handle: discordUsername });
  if (linked.length === 0) return null;

  return (
    <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pt-10">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-[color:var(--hairline)] pt-6">
        {linked.map((l) => (
          <div key={l.label} className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{l.label}</span>
            {l.href ? (
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] text-ink hover:text-accent"
              >
                {l.handle} ↗
              </a>
            ) : (
              <span className="font-mono text-[12px] text-ink">{l.handle}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/// Owner agent picker: a pill per claimed agent (avatar + name), defaulting to
/// the active agent, with only the selected agent's full customize card below.
/// Keeps the workshop/profile tidy on mobile instead of stacking every agent.
function AgentManager({
  agents,
  ownerAddress,
  xLinked,
  discordLinked,
}: {
  agents: AgentState[];
  ownerAddress: string;
  xLinked: boolean;
  discordLinked: boolean;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  useEffect(() => {
    const resolved = resolveActiveAgent(agents, ownerAddress);
    setActiveId(resolved?.id ?? agents[0]?.id ?? null);
  }, [agents, ownerAddress]);

  const active = agents.find((a) => a.id === activeId) ?? agents[0];
  function pick(id: number) {
    setActiveAgentId(ownerAddress, id);
    setActiveId(id);
  }

  return (
    <div className="flex flex-col gap-5">
      {agents.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {agents.map((a) => {
            const selected = a.id === active?.id;
            const label = agentDisplayName(a);
            return (
              <button
                key={a.id}
                onClick={() => pick(a.id)}
                className={`inline-flex items-center gap-2 border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                  selected
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-[color:var(--hairline-strong)] bg-canvas text-ink-2 hover:border-ink hover:text-ink"
                }`}
              >
                <span className="flex h-5 w-5 flex-none items-center justify-center overflow-hidden bg-canvas-3">
                  <AgentAvatar agent={a} size={18} />
                </span>
                <span className="max-w-[140px] truncate">{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <div className="max-w-[760px]">
          <AgentCustomizeCard key={active.id} agent={active} isMe xLinked={xLinked} discordLinked={discordLinked} />
        </div>
      ) : null}
    </div>
  );
}

function AgentCustomizeCard({ agent, isMe, xLinked, discordLinked }: { agent: AgentState; isMe: boolean; xLinked: boolean; discordLinked: boolean }) {
  const [name, setName] = useState<string>(agent.nickname ?? "");
  const [skin, setSkin] = useState<string | null>(agent.skin ?? null);
  const [mode, setMode] = useState<"default" | "x" | "discord" | "custom">(agent.displayMode ?? "x");
  const [busy, setBusy] = useState(false);
  const [skinBusy, setSkinBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [skinNote, setSkinNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(agent.nickname ?? "");
    setSkin(agent.skin ?? null);
    setMode(agent.displayMode ?? "x");
  }, [agent.id, agent.nickname, agent.skin, agent.displayMode]);

  async function pickMode(next: "default" | "x" | "discord" | "custom") {
    if (next === mode) return;
    const prev = mode;
    setMode(next); // optimistic
    const res = await saveAgentDisplayMode(agent.id, next);
    if (!res.ok) {
      setMode(prev);
      setError(res.error);
    }
  }

  async function save() {
    setBusy(true); setError(null);
    const res = await saveAgentName(agent.id, name);
    setBusy(false);
    if (res.ok) {
      setName(res.nickname ?? "");
      setSavedNote(true);
      setTimeout(() => setSavedNote(false), 1500);
    } else setError(res.error);
  }

  // Picking a file no longer saves straight away: it opens the square crop
  // modal so the operator frames their pfp before it's stored.
  function onPickSkin(file: File) {
    if (!file.type.startsWith("image/")) { setError("file must be an image"); return; }
    setError(null);
    setCropFile(file);
  }

  // Save the cropped square the modal hands back (already a 256x256 data URL).
  async function saveCroppedSkin(dataUrl: string) {
    setCropFile(null);
    setSkinBusy(true); setError(null); setSkinNote(null);
    try {
      const res = await saveAgentSkin(agent.id, dataUrl);
      if (res.ok) {
        setSkin(dataUrl);
        setSkinNote("SKIN SAVED");
        setTimeout(() => setSkinNote(null), 1500);
      } else setError(res.error);
    } catch (e) {
      setError(friendlyError(e, "could not save image. try again."));
    } finally {
      setSkinBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function cancelCrop() {
    setCropFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onClearSkin() {
    setSkinBusy(true); setError(null);
    const res = await clearAgentSkin(agent.id);
    setSkinBusy(false);
    if (res.ok) {
      setSkin(null);
      setSkinNote("SKIN CLEARED");
      setTimeout(() => setSkinNote(null), 1500);
    } else setError(res.error);
  }

  const display = (name || agent.nickname || "").trim();

  return (
    <BracketedCell className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden bg-canvas-3">
          {skin ? (
            <img src={skin} alt={display || `agent #${agent.id}`} className="h-full w-full object-cover" />
          ) : (
            <Robot variant="pink" size={42} decorative />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-stencil uppercase text-ink" style={{ fontSize: 18, letterSpacing: "-0.01em" }}>
            {display ? display : `AGENT #${agent.id}`}
          </div>
          <div className="mt-1 font-mono text-[11px] text-ink-3">
            {CONTEST_TYPES.map((t) => `${t.toUpperCase()} T${tierOf(agent, t)}`).join(" · ")}
          </div>
        </div>
      </div>

      {isMe ? (
        <>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">SHOW AS</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {([
                { k: "default", label: "ROBOT", enabled: true, hint: "" },
                { k: "x", label: "X PROFILE", enabled: xLinked, hint: "link your X first" },
                { k: "discord", label: "DISCORD", enabled: discordLinked, hint: "link your discord first" },
                { k: "custom", label: "CUSTOM", enabled: !!skin, hint: "upload a skin first" },
              ] as const).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => opt.enabled && void pickMode(opt.k)}
                  disabled={!opt.enabled}
                  title={!opt.enabled ? opt.hint : undefined}
                  className={
                    mode === opt.k
                      ? "border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                      : opt.enabled
                        ? "border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                        : "cursor-not-allowed border border-[color:var(--hairline)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 opacity-50"
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-ink-3">
              how this agent appears inside a live event. your leaderboard name is set under identity above.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`name agent #${agent.id}`}
              className="min-w-0 flex-1 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none transition-colors focus:border-ink"
              disabled={busy}
              maxLength={24}
            />
            <button
              onClick={save}
              disabled={busy}
              className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
            >
              {busy ? "SAVING…" : "SAVE"}
            </button>
            {savedNote ? <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">SAVED</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickSkin(f); }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={skinBusy}
              className="border border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3 disabled:opacity-60"
            >
              {skinBusy ? "UPLOADING…" : skin ? "REPLACE SKIN" : "UPLOAD CUSTOM SKIN"}
            </button>
            {skin ? (
              <button
                onClick={onClearSkin}
                disabled={skinBusy}
                className="border border-[color:var(--err)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-60"
              >
                CLEAR
              </button>
            ) : null}
            {skinNote ? <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">{skinNote}</span> : null}
          </div>
          <p className="font-mono text-[10px] text-ink-3">crop to a 256×256 square · &lt;200kb</p>

          {error ? <p className="font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}

          {cropFile ? (
            <SkinCropModal file={cropFile} onCancel={cancelCrop} onCrop={saveCroppedSkin} />
          ) : null}
        </>
      ) : null}

      <div className="border-t border-[color:var(--hairline)] pt-3">
        <NftBadge tokenId={agent.erc8004TokenId} />
        <AgentTraits agentId={agent.id} />
      </div>

      <div>
        {isMe ? (
          <a
            href={`/workshop?agent=${agent.id}#train-${agent.id}`}
            className="inline-block border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink transition-colors hover:bg-canvas-3"
          >
            TRAIN WITH SKILLS →
          </a>
        ) : null}
      </div>
    </BracketedCell>
  );
}

function TelegramRow({
  isMe,
  handle,
  telegramId,
  avatarUrl,
  onRefreshed,
  onUnbind,
}: {
  isMe: boolean;
  handle: string | null;
  telegramId: string | null;
  avatarUrl: string | null;
  onRefreshed: () => Promise<void>;
  onUnbind: () => Promise<void>;
}) {
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const widgetMount = useRef<HTMLDivElement>(null);
  const refreshTried = useRef(false);

  // Backfill the avatar once for an own profile that's linked but has no photo
  // (e.g. linked before we captured photos). The Bot API can usually fetch it.
  useEffect(() => {
    if (!isMe || !handle || avatarUrl || refreshTried.current) return;
    refreshTried.current = true;
    void fetch(`${AUTH_URL}/auth/telegram/refresh-avatar`, { method: "POST", credentials: "include" })
      .then((r) => r.json())
      .then((d: { hasAvatar?: boolean }) => { if (d?.hasAvatar) void onRefreshed(); })
      .catch(() => {});
  }, [isMe, handle, avatarUrl, onRefreshed]);

  useEffect(() => {
    let live = true;
    fetch(`${AUTH_URL}/auth/telegram/config`)
      .then((r) => r.json())
      .then((d: { configured?: boolean; botUsername?: string | null }) => {
        if (!live) return;
        setConfigured(!!d.configured);
        setBotUsername(d.botUsername ?? null);
      })
      .catch(() => live && setConfigured(false));
    return () => { live = false; };
  }, []);

  // Telegram's widget binds to the domain registered with BotFather. If we
  // load it from a host that does not match (localhost during dev), the
  // widget renders "Bot domain invalid" inside its iframe. Detect that
  // case and skip mounting; the row falls back to the COMING SOON chip.
  const hostMatchesProd = (() => {
    if (typeof window === "undefined") return false;
    const h = window.location.hostname;
    return h !== "localhost" && h !== "127.0.0.1" && !h.endsWith(".local");
  })();

  useEffect(() => {
    if (!isMe || handle || !configured || !botUsername || !widgetMount.current) return;
    if (!hostMatchesProd) return;
    const host = widgetMount.current;
    host.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "medium");
    script.setAttribute("data-auth-url", `${AUTH_URL}/auth/telegram/callback`);
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-radius", "0");
    host.appendChild(script);
    return () => { host.innerHTML = ""; };
  }, [isMe, handle, configured, botUsername]);

  const displayHandle = handle ? `@${handle}` : telegramId ? `ID ${telegramId}` : "NOT LINKED";
  // Telegram avatars can't be resolved from a username; we use the photo_url
  // captured from the login widget at link time, or none (no broken image).

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        {handle && avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            decoding="async"
            className="h-9 w-9 flex-none rounded-full bg-canvas-3 object-cover"
          />
        ) : handle ? (
          // No captured photo: a clean Telegram-blue initial, not a blank circle.
          <span
            aria-hidden
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#229ED9] font-mono text-[13px] font-medium text-white"
          >
            {handle.slice(0, 1).toUpperCase()}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">TELEGRAM</div>
          <div className="mt-1 font-mono text-sm text-ink">{displayHandle}</div>
          {!handle ? (
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">
              {configured === false || !hostMatchesProd
                ? "Coming soon."
                : "Connect Telegram for alerts when your agent places or a new contest opens."}
            </div>
          ) : null}
        </div>
      </div>

      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : configured && hostMatchesProd ? (
          <div ref={widgetMount} />
        ) : (
          <span className="inline-flex items-center border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            COMING SOON
          </span>
        )
      ) : null}
    </div>
  );
}

function DiscordRow({
  isMe,
  handle,
  avatarUrl,
  onUnbind,
}: {
  isMe: boolean;
  handle: string | null;
  avatarUrl: string | null;
  onUnbind: () => Promise<void>;
}) {
  // Discord avatars are keyed by user id + hash, captured at OAuth time and
  // surfaced here as avatarUrl. When the user has no custom avatar we fall
  // back to a brand-color initial instead of a broken image.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        {handle && avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            width={36}
            height={36}
            loading="lazy"
            decoding="async"
            className="h-9 w-9 flex-none rounded-full bg-canvas-3 object-cover"
          />
        ) : handle ? (
          <span
            aria-hidden
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#5865F2] font-mono text-[13px] font-medium text-white"
          >
            {handle.slice(0, 1).toUpperCase()}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">DISCORD</div>
          <div className="mt-1 font-mono text-sm text-ink">{handle ? handle : "NOT LINKED"}</div>
          {!handle ? (
            <div className="mt-0.5 font-mono text-[11px] text-ink-3">
              Connect your Discord account.
            </div>
          ) : null}
        </div>
      </div>

      {isMe ? (
        handle ? (
          <button
            onClick={onUnbind}
            className="border border-ink-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
          >
            UNBIND
          </button>
        ) : (
          <a
            href={`${AUTH_URL}/auth/discord/start`}
            className="inline-flex items-center gap-2 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            CONNECT DISCORD <span aria-hidden>→</span>
          </a>
        )
      ) : null}
    </div>
  );
}

function SettingRow({
  k,
  label,
  hint,
  options,
  fallback,
}: {
  k: SettingKey;
  label: string;
  hint?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  fallback: string;
}) {
  const [value, setValue] = useState<string>(fallback);
  useEffect(() => { setValue(getSetting(k, fallback)); }, [k, fallback]);
  function pick(v: string) { setValue(v); setSetting(k, v); }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
        {hint ? <p className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => !o.disabled && pick(o.value)}
            disabled={o.disabled}
            className={
              value === o.value
                ? "border border-accent bg-accent px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                : "border border-ink-3 bg-canvas px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/// PASSKEY settings row for Circle email users. Lists enrolled passkeys
/// and exposes ADD A PASSKEY so the user can register a credential on
/// another device. The backend excludes already-known credentials at the
/// registration challenge, so a device that's already enrolled rejects
/// re-registration; a new device sees no conflict and enrols cleanly.
function PasskeysRow() {
  const [passkeys, setPasskeys] = useState<PasskeyRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchPasskeys().then((list) => { if (live) setPasskeys(list); });
    return () => { live = false; };
  }, []);

  async function add() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await enrollPasskey();
      const next = await fetchPasskeys();
      setPasskeys(next);
      setNote("PASSKEY ADDED");
      setTimeout(() => setNote(null), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      let user = friendlyError(e, "could not add passkey.");
      if (e instanceof Error && e.name === "InvalidStateError") {
        user = "this device already has a passkey for this account.";
      } else if (e instanceof Error && e.name === "NotAllowedError") {
        user = "cancelled or timed out. try again.";
      } else if (msg.toLowerCase().includes("excluded")) {
        user = "this device already has a passkey for this account.";
      }
      setError(user);
    } finally {
      setBusy(false);
    }
  }

  const count = passkeys?.length ?? 0;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">PASSKEY</div>
        <div className="mt-1 font-mono text-sm text-ink">
          {passkeys === null ? "loading…" : count === 0 ? "none added" : `${count} ${count === 1 ? "device" : "devices"} enrolled`}
        </div>
        {passkeys && passkeys.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {passkeys.map((p, i) => (
              <li key={p.id} className="font-mono text-[11px] text-ink-3">
                · {p.deviceType === "multiDevice" || p.backedUp ? "synced passkey" : "device-bound passkey"}
                {" · added "}{formatPasskeyDate(p.createdAt)}
                {i === passkeys.length - 1 ? " (this list)" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {note ? <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">{note}</p> : null}
        {error ? <p className="mt-1 font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}
      </div>
      <button
        onClick={add}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink transition-colors hover:bg-accent-press disabled:opacity-60"
      >
        {busy ? "CHECK YOUR DEVICE" : "ADD A PASSKEY"}
      </button>
    </div>
  );
}

function formatPasskeyDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString();
  } catch {
    return iso.slice(0, 10);
  }
}

function ToggleRow({ k, label, hint }: { k: SettingKey; label: string; hint?: string }) {
  const [on, setOn] = useState<boolean>(false);
  useEffect(() => { setOn(getSetting(k, "off") === "on"); }, [k]);
  function toggle() { const next = !on; setOn(next); setSetting(k, next ? "on" : "off"); }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--hairline)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">{label}</div>
        {hint ? <p className="mt-0.5 font-mono text-[11px] text-ink-3">{hint}</p> : null}
      </div>
      <button
        onClick={toggle}
        aria-pressed={on}
        className="inline-flex items-center gap-2 border border-ink-3 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:border-ink"
      >
        <span aria-hidden style={{ color: on ? "var(--accent)" : "var(--ink-3)" }}>●</span>
        {on ? "ON" : "OFF"}
      </button>
    </div>
  );
}
