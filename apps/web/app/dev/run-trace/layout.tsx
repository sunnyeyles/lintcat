import { notFound } from "next/navigation";
import type { ReactNode } from "react";

// In production the page exists only where RUN_TRACE_TOKEN is set; the token still guards the data.
export default function RunTraceLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production" && !process.env.RUN_TRACE_TOKEN) notFound();
  return children;
}
