import type { Metadata } from "next";
import { JetBrains_Mono, Newsreader } from "next/font/google";
import type { CSSProperties, ReactNode } from "react";

import { Sidebar } from "@/components/shell/sidebar";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { Topbar } from "@/components/shell/topbar";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";
import "@/components/shell/fonts.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "PR Review Agents",
  description:
    "Dashboard for the PR review agents: reviews, findings by severity and agent, model usage and cost.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${jetbrainsMono.variable}`}
      style={
        {
          "--font-sans": `var(--font-newsreader), "Iowan Old Style", Georgia, serif`,
          "--font-mono": `var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, monospace`,
        } as CSSProperties
      }
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <div className="min-h-dvh">
              <Topbar />
              <div className="flex">
                <Sidebar />
                <main className="min-w-0 flex-1">
                  <div className="mx-auto w-full max-w-[74rem] px-3 py-6 sm:px-6 sm:py-8">
                    {children}
                  </div>
                </main>
              </div>
            </div>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
