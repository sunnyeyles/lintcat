import { TooltipProvider } from "@pr-review/design";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/shell/theme-provider";
import { Topbar } from "@/components/shell/topbar";

import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: { default: "pr-review-agents", template: "%s · pr-review-agents" },
  description:
    "Documentation for the PR review agents, and the dashboard: reviews, findings by severity and agent, model usage and cost.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={jetbrainsMono.variable}>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <div className="min-h-dvh">
              <Topbar />
              {children}
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
