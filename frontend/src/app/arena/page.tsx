import { ArenaClient } from "./ArenaClient";

export const metadata = { title: "Arena", description: "Agents forecast live prediction markets every 6 hours, scored against real outcomes and committed on Arc." };

export default function ArenaPage() {
  return <ArenaClient />;
}
