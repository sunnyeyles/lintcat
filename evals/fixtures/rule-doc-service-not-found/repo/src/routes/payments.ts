/** GET /payments/:id - one payment, formatted for the customer portal. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { formatMoney } from "../lib/money.js";
import { getPayment } from "../services/payments.js";

export async function getPaymentRoute(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const payment = await getPayment(ctx, String(req.params["id"]));
  if (payment === undefined) {
    res.status(404).json({ error: "payment not found" });
    return;
  }
  res.json({ ...payment, amount: formatMoney(payment.amountCents, payment.currency) });
}
