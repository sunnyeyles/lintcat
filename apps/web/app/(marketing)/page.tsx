import type { Metadata } from "next";

import { JsonLd } from "@/components/json-ld";
import { Audiences, ClosingCta, Faq, Findings, Hero, Steps } from "@/components/landing";
import { HOME_FAQ } from "@/lib/faq";
import { faqPage, organization, webPage, webSite } from "@/lib/structured-data";

const TITLE = "LintCat — code review for people and agents";
const DESCRIPTION =
  "LintCat indexes your repository and reviews every pull request against it, and gives your coding agent the same insight over MCP.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <>
      <JsonLd
        nodes={[
          organization(),
          webSite(DESCRIPTION),
          webPage("/", TITLE, DESCRIPTION),
          faqPage(HOME_FAQ),
        ]}
      />
      <Hero />
      <Audiences />
      <Findings />
      <Steps />
      <Faq />
      <ClosingCta />
    </>
  );
}
