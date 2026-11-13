import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { runTracePageEnabled } from "@/lib/run-trace-page";

export default function RunTraceLayout({ children }: { children: ReactNode }) {
  if (!runTracePageEnabled()) notFound();
  return children;
}
