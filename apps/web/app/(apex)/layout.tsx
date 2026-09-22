import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";
import { SiteFooter } from "@/components/shell/site-footer";
import { Topbar } from "@/components/shell/topbar";

export default function ApexLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Topbar />
      <MainColumn>{children}</MainColumn>
      <SiteFooter />
    </div>
  );
}
