import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConventionEvidence } from "./convention-evidence";

describe("ConventionEvidence", () => {
  it("links every entry to its line at the evidence commit", () => {
    const markup = renderToStaticMarkup(
      <ConventionEvidence
        evidence={[
          { file: "src/data/invoices.ts", line: 27 },
          { file: "src/data/customers.ts", line: 12 },
        ]}
        source={{ owner: "acme", repo: "billing", sha: "abc123" }}
      />,
    );

    expect(markup).toContain(
      'href="https://github.com/acme/billing/blob/abc123/src/data/invoices.ts#L27"',
    );
    expect(markup).toContain(
      'href="https://github.com/acme/billing/blob/abc123/src/data/customers.ts#L12"',
    );
    expect(markup.replace(/<[^>]+>/g, " ")).toContain("src/data/invoices.ts:27");
  });

  it("shows a convention count as its summary, unlinked", () => {
    const summary = "all 4 siblings of src/data/refundRequests.ts use kebab-case file names";
    const markup = renderToStaticMarkup(
      <ConventionEvidence
        evidence={[{ convention: "file-name-casing", file: "src/data/refundRequests.ts", summary }]}
        source={{ owner: "acme", repo: "billing", sha: "abc123" }}
      />,
    );

    expect(markup).toContain(summary);
    expect(markup).not.toContain("href=");
  });
});
