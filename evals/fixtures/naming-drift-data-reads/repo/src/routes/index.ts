/** Route table for the billing API. */
import { Router } from "express";

import { getCreditNoteRoute, getInvoiceCreditNotes } from "./credit-notes.js";
import { getCustomerInvoices } from "./customer-invoices.js";
import { getInvoiceRoute } from "./invoices.js";

export function createRouter(): Router {
  const router = Router();

  router.get("/invoices/:id", getInvoiceRoute);
  router.get("/customers/:customerId/invoices", getCustomerInvoices);
  router.get("/credit-notes/:id", getCreditNoteRoute);
  router.get("/invoices/:id/credit-notes", getInvoiceCreditNotes);

  return router;
}
