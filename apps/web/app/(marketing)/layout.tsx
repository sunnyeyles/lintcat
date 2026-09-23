import type { ReactNode } from "react";

import { DocsTopbar } from "@/components/shell/docs-topbar";
import { SiteFooterFrame } from "@/components/shell/site-footer";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DocsTopbar />
      <main className="flex-1">{children}</main>
      <SiteFooterFrame />
    </div>
  );
}
