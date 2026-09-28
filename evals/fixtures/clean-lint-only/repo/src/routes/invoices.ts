/** GET /invoices/:id - one invoice, formatted for the customer portal. */
import type { Request, Response } from "express";

import { HttpError } from "../http/errors.js";
import { requestContext } from "../http/request-context.js";
import { formatDate } from '../lib/dates.js'
import { formatMoney } from "../lib/money.js";
import { getInvoice } from "../services/invoices.js";

export async function getInvoiceRoute(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  let invoice = await getInvoice(ctx, String(req.params["id"]));
  res.json({
    ...invoice,
    amount: formatMoney(invoice.amountCents, invoice.currency),
    due: formatDate(invoice.dueAt)
  })
}
