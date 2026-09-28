/** Route table for the billing API. */
import { Router } from "express";

import { getCustomerInvoices } from "./customer-invoices.js";
import { getInvoiceRoute } from "./invoices.js";
import { getPaymentRoute } from "./payments.js";

export function createRouter(): Router {
  const router = Router();

  router.get("/invoices/:id", getInvoiceRoute);
  router.get("/customers/:customerId/invoices", getCustomerInvoices);
  router.get("/payments/:id", getPaymentRoute);

  return router;
}
