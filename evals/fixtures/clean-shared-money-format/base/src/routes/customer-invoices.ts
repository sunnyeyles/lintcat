/** GET /customers/:customerId/invoices - a customer's invoice history. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { minorUnits } from "../lib/currency.js";
import { customerInvoices } from "../services/invoices.js";

function formatAmount(amount: number, currency: string): string {
  const exponent = minorUnits(currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amount / 10 ** exponent);
}

export async function getCustomerInvoices(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const invoices = await customerInvoices(ctx, String(req.params["customerId"]));
  res.json({
    invoices: invoices.map((invoice) => ({
      ...invoice,
      amount: formatAmount(invoice.amountCents, invoice.currency),
    })),
  });
}
