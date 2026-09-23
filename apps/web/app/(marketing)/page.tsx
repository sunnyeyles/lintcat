import type { Metadata } from "next";

import { Audiences, ClosingCta, Findings, Hero, Steps } from "@/components/landing";

export const metadata: Metadata = {
  title: { absolute: "LintCat — code review for people and agents" },
  description:
    "LintCat indexes your repository and reviews every pull request against it, and gives your coding agent the same insight over MCP.",
};

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Audiences />
      <Findings />
      <Steps />
      <ClosingCta />
    </>
  );
}
