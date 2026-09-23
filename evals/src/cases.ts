/**
 * The evaluation fixtures and what each must produce. The clean fixture
 * separates a reviewer that finds problems from one that invents them.
 */
import type { FixtureExpectation } from "#src/expectations";

/** One fixture and the expectations its review must satisfy. */
interface EvalCase {
  /** Fixture directory name under evals/fixtures. */
  fixture: string;
  expectations: FixtureExpectation[];
}

/** Precision on fixes: a proposed patch must match the file it edits. */
const patchesVerify: FixtureExpectation = {
  kind: "patches-verify",
  description: "every patch the reviewer proposed matches the file at head",
};

export const evalCases: EvalCase[] = [
  {
    fixture: "architecture-dead-module",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the old PDF template module is left with no importer once the route switches to the new renderer",
        anchors: [
          {
            file: "src/routes/invoice-pdf.ts",
            startMarker: "import { renderInvoicePdf }",
            endMarker: "const pdf = await renderInvoicePdf",
          },
          {
            file: "src/pdf/render-invoice.ts",
            startMarker: "replacing the HTML template",
            endMarker: "export function renderInvoicePdf",
          },
        ],
      },
    ],
  },
  {
    fixture: "architecture-duplicate-helper",
    expectations: [
      patchesVerify,
      {
        kind: "finding",
        description:
          "reports that the reminder's private formatAmount re-implements formatMoney from src/lib/money.ts",
        anchors: [
          {
            file: "src/services/reminders.ts",
            startMarker: "function formatAmount",
            endMarker: "const amount = formatAmount",
          },
        ],
      },
    ],
  },
  {
    fixture: "architecture-layer-bypass",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the CSV route queries the database directly, past the service layer and its voided-invoice rule",
        anchors: [
          {
            file: "src/routes/invoice-export.ts",
            startMarker: 'import { db } from "../db/pool.js";',
            endMarker: "const lines =",
          },
        ],
      },
    ],
  },
  {
    fixture: "architecture-dead-export",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that daysOverdue loses its last caller while agingBucket repeats its arithmetic",
        anchors: [
          {
            file: "src/lib/dates.ts",
            startMarker: "export function daysOverdue",
          },
          {
            file: "src/services/collections.ts",
            startMarker: "import { agingBucket",
          },
        ],
      },
    ],
  },
  {
    fixture: "clean-shared-money-format",
    expectations: [
      patchesVerify,
      {
        kind: "no-findings",
        description:
          "reports no findings on a correct extraction that imports from files outside the diff",
      },
    ],
  },
];
