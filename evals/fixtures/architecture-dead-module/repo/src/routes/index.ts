/** Route table for the billing API. */
import { Router } from "express";

import { getCustomerInvoices } from "./customer-invoices.js";
import { getInvoicePdf } from "./invoice-pdf.js";
import { getInvoiceRoute } from "./invoices.js";

export function createRouter(): Router {
  const router = Router();

  router.get("/invoices/:id", getInvoiceRoute);
  router.get("/customers/:customerId/invoices", getCustomerInvoices);
  router.get("/invoices/:id/pdf", getInvoicePdf);

  return router;
}
