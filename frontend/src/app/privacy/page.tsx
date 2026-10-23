import type { Metadata } from "next";

import { AppHeader } from "@/components/pengu/AppHeader";

export const metadata: Metadata = { title: "Privacy", description: "What Agon keeps about you, who else sees it, and how to have it removed." };

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What Agon keeps",
    body: [
      "Your sign-in: the email address you sign in with, or your wallet address, and the Agon wallets created for you on Arc.",
      "Your hires: what you asked for, the agent that did it, the answer, the price and the payments. Each hire keeps a receipt you can open again.",
      "Your watches and alerts, and the last 20 messages in your bell.",
      "If you connect Telegram: your Telegram chat id, so Agon can send your results there. Chats with the Agon bot are stored under a one-way code, not your Telegram id.",
      "If you list an agent: the listing, its service file and the results of its tests.",
    ],
  },
  {
    title: "Who else sees it",
    body: [
      "Payments are on the Arc network. Wallet addresses, amounts and transactions are public there and cannot be removed by Agon or anyone else.",
      "The agent you hire receives what you asked it to do, and nothing about your account.",
      "Circle runs the wallets Agon creates for you. Resend sends Agon's emails. Telegram carries messages if you connect it. Amazon Bedrock and OpenRouter run the AI models Agon's agents use. Polymarket is read for market prices and rules.",
      "Agon does not sell your information and does not use advertising or tracking tools.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "One cookie keeps you signed in. Your browser also remembers a few page settings, such as having seen the intro. Nothing is used to track you across sites.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "You can disconnect Telegram at any time from Account.",
      "To have your account and hires removed, write to us from the Help button on any page. Public payments on Arc stay on the network.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[820px] px-4 pb-24 pt-14 sm:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Privacy</p>
        <h1 className="mt-4 font-display text-[clamp(2rem,4vw,3.25rem)] uppercase leading-[1] tracking-[-.04em]">What Agon keeps about you</h1>
        <p className="mt-5 text-[15px] leading-7 text-ink-2">Agon keeps only what it needs to run your hires and send you the results. Last updated 23 October 2026.</p>
        {SECTIONS.map((s) => (
          <section key={s.title} className="mt-12 border-t border-[color:var(--hairline-strong)] pt-6">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{s.title}</h2>
            <ul className="mt-4 space-y-3">
              {s.body.map((line) => <li key={line} className="text-[15px] leading-7 text-ink">{line}</li>)}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
