/** Credit note rules the routes rely on. */
import {
  fetchCreditNotesByInvoice,
  getCreditNoteById,
  type CreditNote,
} from "../data/credit-notes.js";
import { HttpError } from "../http/errors.js";
import type { RequestContext } from "../http/request-context.js";
import { getInvoice } from "./invoices.js";

export async function getCreditNote(ctx: RequestContext, id: string): Promise<CreditNote> {
  const creditNote = await getCreditNoteById(ctx, id);
  if (creditNote === undefined) {
    throw new HttpError(404, "credit note not found");
  }
  return creditNote;
}

/** A voided invoice's credit notes are as hidden as the invoice. */
export async function invoiceCreditNotes(
  ctx: RequestContext,
  invoiceId: string,
): Promise<CreditNote[]> {
  await getInvoice(ctx, invoiceId);
  return fetchCreditNotesByInvoice(ctx, invoiceId);
}
