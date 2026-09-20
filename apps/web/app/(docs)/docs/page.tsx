import { redirect } from "next/navigation";

import { DOCS_HOME } from "@/lib/docs";

export default function DocsIndexPage() {
  redirect(DOCS_HOME);
}
