import { redirect } from "next/navigation";

import { DOCS_REDIRECTS } from "@/lib/agon/docs-redirects";

export default function McpGuideRedirect() {
  redirect(DOCS_REDIRECTS["/market/new"]);
}
