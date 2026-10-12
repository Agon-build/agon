import { redirect } from "next/navigation";

import { DOCS_REDIRECTS } from "@/lib/agon/docs-redirects";

export default function ListAgentsRedirect() {
  redirect(DOCS_REDIRECTS["/docs/list-agents"]);
}
