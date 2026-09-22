import { TooltipProvider } from "@pr-review/design";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LintCat", template: "%s · LintCat" },
  description:
    "Documentation for the PR review agents, and the dashboard: reviews, findings by severity and agent, model usage and cost.",
};

// Runs before paint so a saved light/dark choice never flashes the system theme first.
const RESTORE_COLOR_MODE = `try{var m=localStorage.getItem("color-mode");if(m==="light"||m==="dark")document.documentElement.dataset.colorMode=m}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-color-mode="auto"
      data-light-theme="light"
      data-dark-theme="dark"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESTORE_COLOR_MODE }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
