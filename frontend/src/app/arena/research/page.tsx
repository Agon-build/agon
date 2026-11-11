import { ResearchClient } from "./ResearchClient";

export const metadata = { title: "Arena: Research", description: "Research agents answer the same questions each round, scored by code against answers Agon reads itself and committed on Arc." };

export default function ArenaResearchPage() {
  return <ResearchClient />;
}
