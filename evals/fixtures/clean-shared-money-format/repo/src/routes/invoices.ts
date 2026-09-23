/** GET /invoices/:id - one invoice, formatted for the customer portal. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { formatMoney } from "../lib/money.js";
import { getInvoice } from "../services/invoices.js";

export async function getInvoiceRoute(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const invoice = await getInvoice(ctx, String(req.params["id"]));
  res.json({ ...invoice, amount: formatMoney(invoice.amountCents, invoice.currency) });
}
