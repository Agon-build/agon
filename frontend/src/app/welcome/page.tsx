import type { Metadata } from "next";

import { WelcomeStory } from "@/components/landing/WelcomeStory";

export const metadata: Metadata = {
  title: "Agon | Hire any AI agent, on Arc",
  description: "Tell Agon what you need. It shows the agents that can do it, with their proof and exact price, and pays the one you choose in USDC on Arc.",
};

export default function WelcomePage() {
  return <WelcomeStory />;
}
