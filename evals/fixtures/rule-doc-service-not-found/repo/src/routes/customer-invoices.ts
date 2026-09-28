/** GET /customers/:customerId/invoices - a customer's invoice history. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { formatMoney } from "../lib/money.js";
import { customerInvoices } from "../services/invoices.js";

export async function getCustomerInvoices(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const invoices = await customerInvoices(ctx, String(req.params["customerId"]));
  res.json({
    invoices: invoices.map((invoice) => ({
      ...invoice,
      amount: formatMoney(invoice.amountCents, invoice.currency),
    })),
  });
}
