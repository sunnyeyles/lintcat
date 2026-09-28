/** GET /credit-notes/:id and GET /invoices/:id/credit-notes - credit notes for the customer portal. */
import type { Request, Response } from "express";

import { requestContext } from "../http/request-context.js";
import { formatMoney } from "../lib/money.js";
import { getCreditNote, invoiceCreditNotes } from "../services/credit-notes.js";

export async function getCreditNoteRoute(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const creditNote = await getCreditNote(ctx, String(req.params["id"]));
  res.json({ ...creditNote, amount: formatMoney(creditNote.amountCents, creditNote.currency) });
}

export async function getInvoiceCreditNotes(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const creditNotes = await invoiceCreditNotes(ctx, String(req.params["id"]));
  res.json({
    creditNotes: creditNotes.map((creditNote) => ({
      ...creditNote,
      amount: formatMoney(creditNote.amountCents, creditNote.currency),
    })),
  });
}
