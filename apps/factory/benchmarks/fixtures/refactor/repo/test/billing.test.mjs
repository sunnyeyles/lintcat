import assert from "node:assert/strict";
import test from "node:test";

import { invoiceLine } from "../src/invoice.mjs";
import { receipt } from "../src/receipt.mjs";

test("invoice line", () => {
  assert.equal(invoiceLine({ name: "Tea", cents: 350, currency: "EUR" }), "Tea: €3.50");
});

test("receipt", () => {
  assert.equal(receipt({ cents: 1200, currency: "USD", method: "card" }), "Paid $12.00 by card");
});
