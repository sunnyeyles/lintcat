import type { ReactNode } from "react";

import { DocsNavDrawer, DocsSidebar } from "@/components/docs";
import { DocsTopbar } from "@/components/shell/docs-topbar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <DocsTopbar />
      <div className="flex">
        <DocsSidebar />
        <div className="min-w-0 flex-1">
          <div className="border-b border-rule px-4 py-2 sm:px-8 md:hidden">
            <DocsNavDrawer />
          </div>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
