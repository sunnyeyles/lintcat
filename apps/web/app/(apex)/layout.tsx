import type { ReactNode } from "react";

import { MainColumn } from "@/components/shell/main-column";

export default function ApexLayout({ children }: { children: ReactNode }) {
  return <MainColumn>{children}</MainColumn>;
}
