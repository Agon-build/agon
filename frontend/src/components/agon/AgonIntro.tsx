"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { AgonMark } from "@/components/redesign/AgonMark";
import { INTRO_CARDS, INTRO_CARD_MS, introKeyAction, introStep } from "@/lib/agon/intro-cards";

const STARTUP_HOLD_MS = 3000;
const STARTUP_EXIT_MS = 680;

export function AgonIntro({ phase, ready, onEnter }: { phase: "visible" | "exiting"; ready: boolean; onEnter: () => void }) {
  return (
    <>
      <StartupIntro phase={phase} ready={ready} onEnter={onEnter} />
      <style jsx global>{`
        .agon-startup {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: grid;
          place-items: center;
          overflow: hidden;
          isolation: isolate;
          background: #0a0e1a;
          opacity: 1;
          transition: opacity ${STARTUP_EXIT_MS}ms cubic-bezier(.16,1,.3,1);
        }
        .agon-startup-exiting {
          opacity: 0;
          pointer-events: none;
        }
        .agon-startup-smoke {
          position: absolute;
          width: min(56vw, 760px);
          height: min(56vw, 760px);
          border-radius: 50%;
          filter: blur(92px);
          opacity: .42;
          pointer-events: none;
          mix-blend-mode: screen;
        }
        .agon-startup-smoke-pink {
          background: #ff4081;
          transform: translate(-30vw, 12vh) scale(.8);
          animation: agon-smoke-pink 3200ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-smoke-cyan {
          background: #00e5ff;
          transform: translate(30vw, -12vh) scale(.72);
          animation: agon-smoke-cyan 3200ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-noise {
          position: absolute;
          inset: 0;
          opacity: .13;
          pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.7'/%3E%3C/svg%3E");
          mix-blend-mode: soft-light;
        }
        .agon-startup-logo {
          position: relative;
          z-index: 1;
          display: grid;
          place-items: center;
          width: 180px;
          height: 120px;
        }
        .agon-startup-preview-inner {
          min-height: 142px;
          padding: 18px;
          border: 1px solid #2a3142;
          background: #151b29;
          box-shadow: 10px 10px 0 rgba(0, 0, 0, .24);
        }
        .agon-startup-preview-label {
          color: #ff4081;
          font: 10px/1.2 var(--font-mono);
          letter-spacing: .16em;
        }
        .agon-startup-preview-title {
          margin-top: 10px;
          color: #f5f5f5;
          font: 22px/1.05 var(--font-mono);
          text-transform: uppercase;
        }
        .agon-startup-preview-meta,
        .agon-startup-result,
        .agon-startup-service-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 18px;
          color: #9ca3af;
          font: 11px/1.3 var(--font-mono);
        }
        .agon-startup-preview-meta b,
        .agon-startup-result b {
          display: block;
          color: #f5f5f5;
          font-weight: 400;
        }
        .agon-startup-preview-meta small,
        .agon-startup-result small {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: 10px;
        }
        .agon-startup-status,
        .agon-startup-result strong {
          margin-left: auto;
          color: #00e5ff;
          font-weight: 400;
        }
        .agon-startup-result strong {
          color: #ff4081;
          font-size: 26px;
        }
        .agon-startup-avatar {
          display: grid;
          flex: 0 0 36px;
          place-items: center;
          width: 36px;
          height: 36px;
          border: 1px solid #374151;
          color: #0a0e1a;
          font: 18px/1 var(--font-mono);
        }
        .agon-startup-avatar-pink { background: #ff4081; }
        .agon-startup-avatar-cyan { background: #00e5ff; }
        .agon-startup-preview-line {
          height: 2px;
          margin-top: 18px;
          background: #263044;
        }
        .agon-startup-service-row {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid #263044;
        }
        .agon-startup-service-row span:nth-child(2) {
          color: #f5f5f5;
        }
        .agon-startup-service-row i {
          margin-left: auto;
          color: #00e5ff;
          font-style: normal;
          font-size: 10px;
        }
        .agon-startup-mark {
          position: absolute;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #f5f5f5;
          will-change: transform, opacity;
        }
        .agon-startup-mark-small {
          animation: agon-mark-small ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-mark-large {
          animation: agon-mark-large ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-mark-final {
          opacity: 0;
          animation: agon-mark-final ${STARTUP_HOLD_MS}ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-startup-caption {
          position: absolute;
          right: 24px;
          bottom: 20px;
          color: #9ca3af;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: .16em;
          text-transform: uppercase;
        }
        .agon-startup-enter {
          position: absolute;
          right: 50%;
          bottom: 3%;
          z-index: 2;
          min-height: 48px;
          padding: 0 20px;
          border: 1px solid #ff4081;
          color: #0a0e1a;
          background: #ff4081;
          font: 11px/1 var(--font-mono);
          letter-spacing: .14em;
          transform: translateX(50%);
          cursor: pointer;
        }
        .agon-startup-enter:hover,
        .agon-startup-enter:focus-visible {
          border-color: #00e5ff;
          outline: none;
          background: #00e5ff;
        }
        @keyframes agon-smoke-pink {
          0% { opacity: 0; transform: translate(-34vw, 18vh) scale(.62); }
          24% { opacity: .42; }
          64% { opacity: .28; transform: translate(-8vw, 3vh) scale(1.05); }
          100% { opacity: .18; transform: translate(-2vw, 0) scale(1.16); }
        }
        @keyframes agon-smoke-cyan {
          0% { opacity: 0; transform: translate(34vw, -18vh) scale(.58); }
          24% { opacity: .42; }
          64% { opacity: .28; transform: translate(8vw, -3vh) scale(1.02); }
          100% { opacity: .18; transform: translate(2vw, 0) scale(1.12); }
        }
        @keyframes agon-mark-small {
          0% { opacity: 0; transform: translate(-130px, -58px) rotate(-10deg) scale(.62); }
          17% { opacity: 1; }
          54% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
          73% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.85); }
          100% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.85); }
        }
        @keyframes agon-mark-large {
          0% { opacity: 0; transform: translate(130px, 58px) rotate(10deg) scale(.58); }
          17% { opacity: 1; }
          54% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
          73% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.15); }
          100% { opacity: 0; transform: translate(0, 0) rotate(0) scale(1.15); }
        }
        @keyframes agon-mark-final {
          0%, 45% { opacity: 0; transform: scale(.72); }
          60%, 82% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.03); }
        }
        .agon-intro-region {
          position: absolute;
          z-index: 1;
          left: 50%;
          top: 52%;
          width: min(460px, calc(100vw - 32px));
          opacity: 0;
          transform: translate(-50%, calc(-50% + 12px));
          transition: opacity 360ms cubic-bezier(.16,1,.3,1), transform 360ms cubic-bezier(.16,1,.3,1);
          touch-action: pan-y;
        }
        .agon-intro-region-ready { opacity: 1; transform: translate(-50%, -50%); }
        .agon-intro-card {
          min-height: 220px;
          padding: 18px;
          border: 1px solid #2a3142;
          background: #151b29;
          box-shadow: 10px 10px 0 rgba(0, 0, 0, .24);
          animation: agon-intro-in 450ms cubic-bezier(.16,1,.3,1) both;
        }
        .agon-intro-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .agon-intro-chip { padding: 4px 6px; border: 1px solid #374151; color: #9ca3af; font: 9px/1 var(--font-mono); letter-spacing: .14em; }
        .agon-intro-lines { display: grid; gap: 8px; margin: 14px 0 0; padding: 0; list-style: none; color: #c3c8d2; font: 12px/1.45 var(--font-mono); }
        .agon-intro-lines li { padding-top: 8px; border-top: 1px solid #263044; overflow-wrap: anywhere; }
        .agon-intro-controls { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
        .agon-intro-tick { display: flex; flex: 1; align-items: center; min-height: 44px; padding: 0; border: 0; background: none; cursor: pointer; }
        .agon-intro-track { display: block; width: 100%; height: 3px; overflow: hidden; background: #263044; }
        .agon-intro-tick:hover .agon-intro-track, .agon-intro-tick:focus-visible .agon-intro-track { background: #4b5563; }
        .agon-intro-tick:focus-visible { outline: 1px solid #00e5ff; outline-offset: 2px; }
        .agon-intro-tick-fill { display: block; height: 100%; background: #ff4081; transform-origin: left; animation: agon-intro-fill ${INTRO_CARD_MS}ms linear both; }
        .agon-intro-tick-past { display: block; height: 100%; background: #6b7280; }
        .agon-intro-paused .agon-intro-tick-fill { animation-play-state: paused; }
        .agon-intro-manual .agon-intro-tick-fill { animation: none; transform: none; }
        .agon-intro-pause { min-height: 44px; padding: 0 10px; border: 1px solid #4b5563; color: #f5f5f5; background: transparent; font: 10px/1 var(--font-mono); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; }
        .agon-intro-pause:hover, .agon-intro-pause:focus-visible { border-color: #ff4081; outline: none; }
        @keyframes agon-intro-in { from { opacity: 0; transform: translateX(32px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes agon-intro-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @keyframes agon-intro-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes agon-intro-fade { from { opacity: 0; } to { opacity: 1; } }

        @media (prefers-reduced-motion: reduce) {
          .agon-startup { transition: none; }
          .agon-startup-smoke, .agon-startup-mark { animation: none; }
          .agon-intro-card { animation: agon-intro-fade 200ms linear both; }
          .agon-intro-tick-fill { animation: none; transform: none; }
          .agon-intro-region { transition: none; }
          .agon-startup-mark-small, .agon-startup-mark-large { opacity: 0; }
          .agon-startup-mark-final { opacity: 1; }
        }
        @media (max-width: 640px) {
          .agon-startup-smoke { width: 72vw; height: 72vw; filter: blur(64px); }
          .agon-intro-region { top: 50%; width: calc(100vw - 32px); }
          .agon-intro-card { min-height: 200px; padding: 14px; }
          .agon-startup-preview-inner { min-height: 126px; padding: 14px; }
          .agon-startup-preview-title { font-size: 17px; }
          .agon-startup-enter { bottom: 9%; min-height: 44px; padding: 0 16px; }
        }
      `}</style>
    </>
  );
}

function StartupIntro({ phase, ready, onEnter }: { phase: "visible" | "exiting"; ready: boolean; onEnter: () => void }) {
  const [state, dispatch] = useReducer(introStep, { index: 0, paused: false, manual: false });
  const [userPaused, setUserPaused] = useState(false);
  const startX = useRef<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), INTRO_CARD_MS);
    return () => window.clearInterval(timer);
  }, [ready]);

  // Enter leaves from the first frame; the arrows move the cards once they show.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = introKeyAction(event.key, Boolean(target?.closest("button, a, input, textarea, select")));
      if (!action || (action !== "enter" && !ready)) return;
      event.preventDefault();
      if (action === "enter") onEnter();
      else dispatch({ type: action });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, onEnter]);

  const card = INTRO_CARDS[state.index]!;
  const hold = () => dispatch({ type: "pause" });
  const release = () => { if (!userPaused) dispatch({ type: "resume" }); };

  return (
    <div className={`agon-startup ${phase === "exiting" ? "agon-startup-exiting" : ""}`} role="region" aria-label="Agon intro">
      <div className="agon-startup-smoke agon-startup-smoke-pink" aria-hidden="true" />
      <div className="agon-startup-smoke agon-startup-smoke-cyan" aria-hidden="true" />
      <div className="agon-startup-noise" aria-hidden="true" />
      <div className="agon-startup-logo" aria-hidden="true">
        <span className="agon-startup-mark agon-startup-mark-small"><AgonMark size={28} showWordmark={false} /></span>
        <span className="agon-startup-mark agon-startup-mark-large"><AgonMark size={72} showWordmark={false} /></span>
        <span className="agon-startup-mark agon-startup-mark-final"><AgonMark size={62} /></span>
      </div>
      <button type="button" className="agon-startup-enter" onClick={onEnter}>ENTER AGON <span aria-hidden="true">→</span></button>
      <section
        aria-roledescription="carousel"
        aria-label="What Agon does"
        aria-hidden={!ready}
        className={`agon-intro-region ${ready ? "agon-intro-region-ready" : ""} ${state.paused ? "agon-intro-paused" : ""} ${state.manual ? "agon-intro-manual" : ""}`}
        onMouseEnter={hold}
        onMouseLeave={release}
        onFocus={hold}
        onBlur={release}
        onPointerDown={(event) => { startX.current = event.clientX; }}
        onPointerUp={(event) => {
          if (startX.current === null) return;
          const dx = event.clientX - startX.current;
          startX.current = null;
          if (dx <= -40) dispatch({ type: "next" });
          else if (dx >= 40) dispatch({ type: "prev" });
        }}
      >
        <div key={card.id} className="agon-intro-card" role="group" aria-roledescription="slide" aria-label={`${state.index + 1} of ${INTRO_CARDS.length}`}>
          <div className="agon-intro-head">
            <span className="agon-startup-preview-label">{card.eyebrow.toUpperCase()}</span>
            {card.label ? <span className="agon-intro-chip">{card.label === "example" ? "EXAMPLE" : "COMING NEXT"}</span> : null}
          </div>
          <div className="agon-startup-preview-title">{card.title}</div>
          <ul className="agon-intro-lines">{card.lines.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
        <div className="agon-intro-controls">
          {INTRO_CARDS.map((c, i) => (
            <button key={c.id} type="button" className="agon-intro-tick" aria-label={`Show card ${i + 1}: ${c.title}`} aria-current={i === state.index ? "true" : undefined} onClick={() => dispatch({ type: "goto", index: i })}>
              <span className="agon-intro-track">
                {i === state.index ? <span key={state.index} className="agon-intro-tick-fill" /> : i < state.index ? <span className="agon-intro-tick-past" /> : null}
              </span>
            </button>
          ))}
          <button type="button" className="agon-intro-pause" onClick={() => { const next = !userPaused; setUserPaused(next); dispatch({ type: next ? "pause" : "resume" }); }}>{userPaused ? "Play" : "Pause"}</button>
        </div>
      </section>
      <div className="agon-startup-caption">DESCRIBE IT. AGON ROUTES IT.</div>
    </div>
  );
}
