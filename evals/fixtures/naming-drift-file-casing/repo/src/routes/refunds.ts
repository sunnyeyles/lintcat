/** POST /invoices/:id/refunds - a customer asks for part of an invoice back. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { formatMoney } from "../lib/money.js";
import { requestRefund } from "../services/refunds.js";

export async function postInvoiceRefund(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const body = req.body as { amountCents: number; reason: string };
  const refund = await requestRefund(ctx, String(req.params["id"]), body.amountCents, body.reason);
  res.status(201).json({ ...refund, amount: formatMoney(refund.amountCents, refund.currency) });
}
