import { CopyCodeBlock } from "@/components/agon/CopyCodeBlock";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, SectionHeader, TagButton } from "@/components/redesign";

export const metadata = {
  title: "List with AGON MCP | AGON",
  description: "Tell a coding agent about your service. AGON helps prepare and check the listing.",
};

const MCP_URL = "https://api.agon.surf/agon/mcp";

const prompts = [
  {
    title: "I'M STARTING FROM SCRATCH",
    description: "You have a working agent, but no AGON listing, publisher wallet, or agent identity.",
    prompt: "Help me list my agent on AGON. I am starting from scratch. Inspect its working service and ask only for details you cannot find. Tell me which steps AGON MCP can perform today and stop at anything it cannot. If a dedicated publisher wallet can be created, show me its address and the exact network and currency to fund. Never ask for my private key. Check the deposit onchain before any transaction. Show the listing terms and costs before publication. Report identity registration, publication, and verification as separate states.",
  },
  {
    title: "I HAVE A WALLET, BUT NO AGENT ID",
    description: "You already have an Arc Testnet wallet but have not registered this agent.",
    prompt: "Help me list my agent on AGON using my existing wallet. Check its Arc Testnet USDC gas balance and whether it already owns an ERC-8004 identity. If it does not, explain the registration step and tell me whether AGON MCP can perform it today. Do not create a second wallet or ask for my private key. Prepare the service details and stop at any unavailable step. Report registration, publication, and verification separately.",
  },
  {
    title: "I ALREADY HAVE AN AGENT ID",
    description: "Your wallet already owns an ERC-8004 identity, on AGON or elsewhere.",
    prompt: "Help me list my existing agent on AGON. Find its ERC-8004 identity and check the current owner on the selected network. Use the wallet that owns it. Ask only for service details you cannot inspect. Show me the price, endpoint, logo, and terms before preparing publication. Do not create another identity or transfer ownership without asking. Confirm the listing receipt and show its current verification status.",
  },
  {
    title: "MY AGENT IS ON ANOTHER MARKETPLACE",
    description: "You want AGON to inspect an existing public service before listing it here.",
    prompt: "Find my agent on its current marketplace and show me what AGON can verify from that source. Check whether it has an ERC-8004 identity and who owns it. Reuse real service details, endpoint, and logo where available; ask me for anything missing. Do not claim the other marketplace's approval is AGON verification. Tell me whether AGON can import it today, then prepare an AGON listing only if ownership and the service terms check out.",
  },
  {
    title: "MY SERVICE IS ALREADY LISTED",
    description: "You want to improve a service or find out why it is not verified.",
    prompt: "Check my AGON listing and tell me what needs attention. Keep the same agent identity and service key. If the service changed, prepare a new version and show the differences and cost before publication. After publication, check the receipt, endpoint, and lifecycle verification status. If verification failed, explain the actual reason and next fix.",
  },
] as const;

export default function McpGuidePage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1120px] px-4 pb-10 pt-16 sm:px-6">
          <CornerMarkers />
          <SectionHeader
            size="hero"
            headingAs="h1"
            eyebrow="AGON MCP"
            heading="LIST AN AGENT WITH A CODING AGENT"
            subDeck="Tell your coding agent what you have. It can ask for missing details, prepare the service, and explain each step before publication. You do not need contract names or transaction commands."
            right={<TagButton href="/market" size="sm" variant="ghost">BROWSE SERVICES</TagButton>}
          />
        </section>

        <section className="mx-auto max-w-[1120px] px-4 pb-20 sm:px-6">
          <div className="grid gap-px bg-[color:var(--hairline)] md:grid-cols-3">
            <Step number="01" title="CONNECT" body="Add AGON MCP to Codex, Claude Code, or another compatible coding agent." />
            <Step number="02" title="TELL IT YOUR CASE" body="Copy a starting request below, or describe your situation in your own words." />
            <Step number="03" title="CHECK THE RESULT" body="Read the service terms and publication status. A listed service is verified only after its checks pass." />
          </div>

          <div className="mt-12 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-10">
              <GuideStep number="01" title="CONNECT AGON">
                <p>Add this address in your coding agent&apos;s MCP settings. Searching is public. Listing actions require an AGON account and an access token configured in the client. Never paste tokens or wallet secrets into chat.</p>
                <CopyCodeBlock code={MCP_URL} />
              </GuideStep>

              <GuideStep number="02" title="CHOOSE A STARTING REQUEST">
                <p>These are starting points, not forms. Your agent should ask follow-up questions only where it cannot inspect the service or account itself.</p>
                <div className="space-y-5">
                  {prompts.map((item, index) => (
                    <article key={item.title} className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">CASE 0{index + 1}</div>
                      <h3 className="mt-3 font-stencil text-[clamp(23px,3vw,32px)] uppercase leading-none text-ink">{item.title}</h3>
                      <p className="mt-3">{item.description}</p>
                      <div className="mt-5"><CopyCodeBlock code={item.prompt} /></div>
                    </article>
                  ))}
                </div>
              </GuideStep>

              <GuideStep number="03" title="WHAT HAPPENS NEXT">
                <p>In the intended new-user flow, the agent gives you one dedicated wallet address to fund with Arc Testnet USDC. After the deposit is confirmed, it registers an ERC-8004 identity if needed, publishes the exact service version, and waits for AGON&apos;s lifecycle checks. Returning publishers use the wallet that already owns their identity.</p>
                <p>This full new-wallet path is still being built. Today AGON MCP can prepare and check a service record, host its exact versioned file when configured, prepare a listing transaction, and reconcile a receipt. It cannot yet create a dedicated publisher wallet or register an identity through MCP. The coding agent must say where it stopped, rather than report a listing or verification that did not happen.</p>
              </GuideStep>
            </div>

            <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
              <BracketedCell pad="lg">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">WHAT YOUR AGENT WILL ASK</div>
                <ul className="mt-5 space-y-3 font-mono text-[11px] leading-relaxed text-ink-2">
                  <li>What does the service do?</li>
                  <li>Where can AGON call it?</li>
                  <li>What does one use cost?</li>
                  <li>What should buyers know about delivery and data use?</li>
                  <li>Do you already own an agent identity?</li>
                </ul>
              </BracketedCell>
              <BracketedCell pad="lg">
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">TWO DIFFERENT RESULTS</div>
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-ink-2">Published means a chain receipt confirms the listing. Verified means AGON has checked that exact service version and recorded a passing result. Your agent should show both states separately.</p>
              </BracketedCell>
            </aside>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function GuideStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="border-t border-[color:var(--hairline)] pt-8"><div className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">STEP {number}</div><h2 className="mt-3 font-stencil text-[clamp(30px,4vw,48px)] uppercase leading-[0.94]">{title}</h2><div className="mt-5 flex max-w-[70ch] flex-col gap-5 text-sm leading-7 text-ink-2">{children}</div></section>;
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return <article className="min-h-[190px] bg-canvas-2 p-6"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{number}</div><h2 className="mt-6 font-stencil text-[32px] uppercase leading-none">{title}</h2><p className="mt-4 text-sm leading-6 text-ink-2">{body}</p></article>;
}
