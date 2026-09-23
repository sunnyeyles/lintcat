/** Lays out the invoice PDF with pdfkit, replacing the HTML template. */
import PDFDocument from "pdfkit";

import type { Invoice } from "../data/invoices.js";
import { formatMoney } from "../lib/money.js";

export function renderInvoicePdf(invoice: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(`Invoice ${invoice.number}`);
    doc.moveDown();
    doc.fontSize(12).text(`Amount due: ${formatMoney(invoice.amountCents, invoice.currency)}`);
    doc.text(`Due: ${invoice.dueAt.slice(0, 10)}`);
    doc.end();
  });
}
