import type { ReactNode } from "react";

import { DocsNavDrawer, DocsSidebar } from "@/components/docs";
import { AskAiButton } from "@/components/docs-chat";
import { DocsTopbar } from "@/components/shell/docs-topbar";
import { SiteFooterFrame } from "@/components/shell/site-footer";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <DocsTopbar actions={<AskAiButton />} />
      <div className="flex flex-1">
        <DocsSidebar />
        <div className="min-w-0 flex-1">
          <div className="border-b border-border px-4 py-2 sm:px-8 md:hidden">
            <DocsNavDrawer />
          </div>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
      <SiteFooterFrame />
    </div>
  );
}
