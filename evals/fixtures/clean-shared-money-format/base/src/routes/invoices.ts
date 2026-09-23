/** GET /invoices/:id - one invoice, formatted for the customer portal. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { getInvoice } from "../services/invoices.js";

function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amountCents / 100,
  );
}

export async function getInvoiceRoute(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const invoice = await getInvoice(ctx, String(req.params["id"]));
  res.json({ ...invoice, amount: formatMoney(invoice.amountCents, invoice.currency) });
}
