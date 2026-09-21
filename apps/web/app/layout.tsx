import { TooltipProvider } from "@pr-review/design";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "pr-review-agents", template: "%s · pr-review-agents" },
  description:
    "Documentation for the PR review agents, and the dashboard: reviews, findings by severity and agent, model usage and cost.",
};

// Primer's `auto` colour mode follows prefers-color-scheme; there is no in-app toggle.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
