/** Renders the invoice PDF from an HTML template in headless Chrome. */
import htmlPdf from "html-pdf-node";

import type { Invoice } from "../data/invoices.js";
import { formatMoney } from "../lib/money.js";

function invoiceHtml(invoice: Invoice): string {
  return `<!doctype html>
<html>
  <body style="font-family: Helvetica, sans-serif">
    <h1>Invoice ${invoice.number}</h1>
    <p>Amount due: ${formatMoney(invoice.amountCents, invoice.currency)}</p>
    <p>Due: ${invoice.dueAt.slice(0, 10)}</p>
  </body>
</html>`;
}

export async function renderLegacyInvoice(invoice: Invoice): Promise<Buffer> {
  return htmlPdf.generatePdf({ content: invoiceHtml(invoice) }, { format: "A4" });
}
