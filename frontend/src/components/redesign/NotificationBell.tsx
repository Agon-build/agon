"use client";

import { useEffect, useRef, useState } from "react";
import { useNotifications } from "@/hooks/useNotifications";
import { IS_AGON_DEPLOYMENT } from "@/lib/product";
import { staysUntilAcknowledged, type AppNotification } from "@/lib/notifications";
import { setSoundMuted } from "@/lib/sounds";

/// Bell in the top nav. Shows an unread badge, opens a dropdown feed, plays a
/// chime on new notifications (handled by the hook). Renders nothing when the
/// operator is not signed in.

const KIND_MARK: Record<string, string> = {
  contest_win: "■",
  challenge_win: "■",
  challenge_invite: "■",
  challenge_refund: "■",
  syndicate_payout: "■",
  balance_credit: "■",
  balance_debit: "■",
  training_done: "■",
  mystery_win: "■",
  custom_request: "■",
  arena_review_escalation: "!",
  agon_service_lifecycle: "!",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NotificationBell() {
  const { items, unread, markRead, markAllRead, clearAll, acknowledge, setSound, isSignedIn } = useNotifications();
  const clearable = items.some((n) => !staysUntilAcknowledged(n));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    setSound(soundOn); // notification chime
    setSoundMuted(!soundOn); // all other UI sounds (join, win, mystery)
  }, [soundOn, setSound]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!isSignedIn) return null;

  function toggle() {
    // Don't auto-mark on open; the user marks read explicitly via the button
    // so unread items stay highlighted until they choose to clear the state.
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        className="relative flex h-11 w-11 min-h-11 min-w-11 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas text-ink transition-colors hover:bg-canvas-3"
      >
        <BellGlyph />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-accent px-1 font-mono text-[9px] font-medium text-accent-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed left-3 right-3 top-[4.5rem] z-modal border border-ink bg-canvas shadow-[0_12px_40px_rgba(26,22,18,0.18)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[340px]">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> NOTIFICATIONS
            </span>
            <div className="flex items-center gap-3">
              {unread > 0 ? (
                <button
                  onClick={() => void markAllRead()}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                  title="mark all as read"
                >
                  MARK READ
                </button>
              ) : null}
              {clearable ? (
                <button
                  onClick={() => void clearAll()}
                  className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                  title="clear all notifications"
                >
                  CLEAR
                </button>
              ) : null}
              <button
                onClick={() => setSoundOn((s) => !s)}
                className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
                title="toggle sound"
              >
                {soundOn ? "SOUND ON" : "SOUND OFF"}
              </button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-6 font-mono text-[12px] text-ink-3">
                {IS_AGON_DEPLOYMENT ? "Nothing yet. Hires, deliveries and payments land here." : "nothing yet. wins, invites, and training updates land here."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {items.map((n) => (
                  <Row
                    key={n.id}
                    n={n}
                    onRead={() => void markRead(n.id)}
                    onNavigate={() => setOpen(false)}
                    onAcknowledge={() => void acknowledge(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/// An open critical alert stays until its owner acknowledges it, and says so.
function Acknowledge({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline)] bg-canvas-2 px-4 pb-3 pl-10">
      <span className="font-mono text-[10px] text-ink-3">Stays until you acknowledge it.</span>
      <button type="button" onClick={onAcknowledge} className="min-h-11 font-mono text-[10px] uppercase tracking-[0.12em] text-ink underline underline-offset-4 hover:text-accent">ACKNOWLEDGE</button>
    </div>
  );
}

function Row({ n, onRead, onNavigate, onAcknowledge }: { n: AppNotification; onRead: () => void; onNavigate: () => void; onAcknowledge: () => void }) {
  const ack = staysUntilAcknowledged(n) ? <Acknowledge onAcknowledge={onAcknowledge} /> : null;
  const inner = (
    <div
      className={`flex gap-3 border-b border-[color:var(--hairline)] px-4 py-3 transition-colors hover:bg-canvas-2 last:border-0 ${
        n.read ? "" : "bg-canvas-2"
      }`}
    >
      <span aria-hidden className={`mt-0.5 ${n.read ? "text-ink-3" : "text-accent"}`}>{KIND_MARK[n.kind] ?? "■"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-mono text-[12px] ${n.read ? "text-ink-2" : "text-ink"}`}>
            {n.title}{n.severity ? <span className="ml-2 text-[9px] uppercase tracking-[0.12em] text-accent">{n.severity}</span> : null}
          </span>
          <span className="flex-none font-mono text-[10px] text-ink-3">{timeAgo(n.createdAt)}</span>
        </div>
        {n.body ? <p className="mt-1 font-mono text-[11px] leading-[1.5] text-ink-2">{n.body}</p> : null}
      </div>
    </div>
  );
  if (n.href) {
    return (
      <li>
        <a
          href={n.href}
          onClick={() => { onRead(); onNavigate(); }}
          className="block"
        >
          {inner}
        </a>
        {ack}
      </li>
    );
  }
  // No destination, but a click still clears the unread state.
  return (
    <li>
      <button type="button" onClick={onRead} className="block w-full text-left">
        {inner}
      </button>
      {ack}
    </li>
  );
}

function BellGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2.2c-2 0-3.3 1.5-3.3 3.4 0 2.6-.8 3.5-1.4 4.1-.3.3-.1.8.3.8h8.8c.4 0 .6-.5.3-.8-.6-.6-1.4-1.5-1.4-4.1 0-1.9-1.3-3.4-3.3-3.4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M6.6 12.6a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
