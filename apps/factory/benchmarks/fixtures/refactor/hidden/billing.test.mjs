import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { invoiceLine, invoiceTotal } from "../src/invoice.mjs";
import { formatMoney } from "../src/money.mjs";
import { receipt } from "../src/receipt.mjs";

const source = (file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("behaviour is unchanged", () => {
  assert.equal(invoiceLine({ name: "Tea", cents: 350, currency: "EUR" }), "Tea: €3.50");
  assert.equal(invoiceLine({ name: "Refund", cents: -5, currency: "USD" }), "Refund: -$0.05");
  assert.equal(invoiceTotal([{ cents: 999, currency: "EUR" }, { cents: 1, currency: "EUR" }]), "Total: €10.00");
  assert.equal(invoiceTotal([]), "Total: $0.00");
  assert.equal(receipt({ cents: 1200, currency: "USD", method: "card" }), "Paid $12.00 by card");
  assert.equal(receipt({ cents: -250, currency: "EUR", method: "cash" }), "Paid -€2.50 by cash");
});

test("formatMoney is the one formatter", () => {
  assert.equal(formatMoney(350, "EUR"), "€3.50");
  assert.equal(formatMoney(-5, "USD"), "-$0.05");
  for (const file of ["invoice.mjs", "receipt.mjs"]) {
    assert.match(source(file), /from "\.\/money\.mjs"/);
    assert.doesNotMatch(source(file), /toFixed/);
  }
});
