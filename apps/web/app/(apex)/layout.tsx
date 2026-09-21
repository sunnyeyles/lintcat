import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";
import { Topbar } from "@/components/shell/topbar";

export default function ApexLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Topbar />
      <MainColumn>{children}</MainColumn>
    </div>
  );
}
