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
    fixture: "security-tenant-scope",
    expectations: [
      patchesVerify,
      {
        kind: "finding",
        description:
          "reports a finding on the customer query that never validates the tenant",
        anchors: [
          {
            file: "src/data/customers.ts",
            startMarker: "export async function findCustomerById",
          },
          {
            file: "src/routes/customer-detail.ts",
            startMarker: "export async function getCustomer",
          },
        ],
      },
    ],
  },
  {
    fixture: "correctness-admin-check",
    expectations: [
      {
        kind: "finding",
        description:
          "reports a finding on the since filter, which keeps the events before the timestamp instead of the events after it",
        anchors: [
          {
            file: "src/routes/admin-audit.ts",
            startMarker: "export async function getAuditEvents",
          },
        ],
      },
    ],
  },
  {
    fixture: "correctness-cross-file-caller",
    expectations: [
      {
        kind: "finding",
        description:
          "reports a finding on the quote whose total changed from a formatted string to a Money value, which an untouched caller still renders straight into an email",
        anchors: [
          {
            file: "src/pricing/quote.ts",
            startMarker: "export interface ShippingQuote",
            endMarker: "export async function quoteShipment",
          },
          {
            file: "src/pricing/quote.ts",
            startMarker: "export async function quoteShipment",
          },
        ],
      },
    ],
  },
  {
    fixture: "test-coverage-untested-branch",
    expectations: [
      {
        kind: "finding",
        description:
          "reports a finding on the new bulk tier branch the untouched discount test never exercises",
        anchors: [
          {
            file: "src/pricing/discount.ts",
            startMarker: "export const BULK_PARCEL_RATE",
          },
          {
            file: "src/pricing/discount.ts",
            startMarker: "export function applyDiscount",
          },
        ],
      },
    ],
  },
  {
    fixture: "performance-n-plus-one",
    expectations: [
      {
        kind: "finding",
        description:
          "reports a finding on the summary loop that queries one product per order line",
        anchors: [
          {
            file: "src/services/order-summary.ts",
            startMarker: "export async function buildOrderSummary",
          },
        ],
      },
    ],
  },
  {
    fixture: "docs-drift-retry-budget",
    expectations: [
      {
        kind: "finding",
        description:
          "reports a finding on the retry budget that replaced the attempt count the README and the runbook still document",
        anchors: [
          {
            file: "src/config.ts",
            startMarker: "export const RETRY_BUDGET_ENV",
          },
          {
            file: "src/delivery/retry.ts",
            startMarker: "export async function withRetryBudget",
          },
        ],
      },
    ],
  },
  {
    fixture: "clean-pagination",
    expectations: [
      patchesVerify,
      {
        kind: "no-findings",
        description: "reports no findings at all on correct, idiomatic code",
      },
    ],
  },
];
