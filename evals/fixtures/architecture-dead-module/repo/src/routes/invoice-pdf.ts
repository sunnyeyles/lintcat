/** GET /invoices/:id/pdf - the printable invoice. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { renderInvoicePdf } from "../pdf/render-invoice.js";
import { getInvoice } from "../services/invoices.js";

export async function getInvoicePdf(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const invoice = await getInvoice(ctx, String(req.params["id"]));
  const pdf = await renderInvoicePdf(invoice);
  res.type("application/pdf").send(pdf);
}
