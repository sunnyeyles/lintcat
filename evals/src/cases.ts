/**
 * The evaluation fixtures and what each must produce. The clean fixtures
 * separate a reviewer that finds drift from one that invents it.
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

/** A bug that is not drift: the drift reviewer must leave it alone. */
function outOfScope(description: string): FixtureExpectation {
  return { kind: "no-findings", description };
}

export const evalCases: EvalCase[] = [
  {
    fixture: "naming-drift-data-reads",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the credit-note reads are named get*/fetch* where every other data module names them find*/list*",
        anchors: [
          {
            file: "src/data/credit-notes.ts",
            startMarker: "export async function getCreditNoteById",
          },
          {
            file: "src/services/credit-notes.ts",
            startMarker: "  fetchCreditNotesByInvoice,",
            endMarker: "const creditNote = await getCreditNoteById",
          },
        ],
      },
    ],
  },
  {
    fixture: "rule-doc-service-not-found",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the payment service returns undefined for a hidden payment, citing the AGENTS.md rule that services throw HttpError(404)",
        anchors: [
          {
            file: "src/services/payments.ts",
            startMarker: "export async function getPayment(",
            endMarker: "return payment;",
          },
          {
            file: "src/routes/payments.ts",
            startMarker: "if (payment === undefined) {",
            endMarker: "res.status(404)",
          },
        ],
        cites: [
          { file: "AGENTS.md", marker: "It never returns `undefined` for a route to check." },
          { file: "AGENTS.md", marker: "Routes never set an error status themselves" },
        ],
      },
    ],
  },
  {
    fixture: "clean-lint-only",
    expectations: [
      {
        kind: "no-findings",
        description:
          "reports nothing on a change whose only problems — an unused import, a let, single quotes, missing semicolons — the repository's ESLint and Prettier already catch",
      },
    ],
  },
  {
    fixture: "clean-no-convention-lib",
    expectations: [
      patchesVerify,
      {
        kind: "no-findings",
        description:
          "reports no findings on a helper added to a directory whose files share no naming or export convention",
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
          "reports that the CSV route queries the database directly, past the service layer every other route goes through",
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
  {
    fixture: "docs-drift-retry-budget",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the retry budget replaced the attempt count the README and the runbook still document",
        anchors: [
          { file: "src/config.ts", startMarker: "export const RETRY_BUDGET_ENV" },
          { file: "src/delivery/retry.ts", startMarker: "export async function withRetryBudget" },
        ],
      },
    ],
  },
  {
    fixture: "docs-broken-anchor",
    expectations: [
      {
        kind: "finding",
        description: "reports that the new README link names a runbook heading that does not exist",
        anchors: [{ file: "README.md", startMarker: "docs/runbook.md#the-queue-is-stuck" }],
      },
    ],
  },
  {
    fixture: "clean-docs-valid-anchor",
    expectations: [
      {
        kind: "no-findings",
        description: "reports nothing on a README link to a runbook heading the diff does not show",
      },
    ],
  },
  {
    fixture: "clean-docs-reword",
    expectations: [
      {
        kind: "no-findings",
        description: "reports nothing on a README section reworded to say less while staying true",
      },
    ],
  },
  {
    fixture: "config-undocumented-env-var",
    expectations: [
      {
        kind: "finding",
        description:
          "reports that the worker reads NOTIFY_SIGNING_SECRET, which neither .env.example nor the README lists beside the other variables",
        anchors: [
          { file: "src/config.ts", startMarker: "const signingSecret = env.NOTIFY_SIGNING_SECRET" },
        ],
      },
    ],
  },
  {
    fixture: "config-duplicate-dependency",
    expectations: [
      {
        kind: "finding",
        description: "reports that dayjs joins a worker that already does its date work with date-fns",
        anchors: [
          { file: "package.json", startMarker: '"dayjs": "^1.11.13"' },
          { file: "src/delivery/quiet-hours.ts", startMarker: 'import dayjs from "dayjs";' },
        ],
      },
    ],
  },
  {
    fixture: "clean-config-env-var-documented",
    expectations: [
      {
        kind: "no-findings",
        description:
          "reports nothing on a new env var that lands in .env.example and the README with the code that reads it",
      },
    ],
  },
  {
    fixture: "correctness-admin-check",
    expectations: [
      outOfScope(
        "reports nothing on a route that follows its siblings' shape, though its since filter keeps the wrong events",
      ),
    ],
  },
  {
    fixture: "correctness-cross-file-caller",
    expectations: [
      outOfScope(
        "reports nothing on a return type that now matches the pricing code's Money, though an untouched caller still renders it as a string",
      ),
    ],
  },
  {
    fixture: "security-open-redirect",
    expectations: [
      outOfScope(
        "reports nothing on a route with no precedent to drift from, though it redirects wherever its query string says",
      ),
    ],
  },
  {
    fixture: "performance-n-plus-one",
    expectations: [
      outOfScope(
        "reports nothing on a lookup named like its siblings, though the summary now queries once per order line",
      ),
    ],
  },
];
