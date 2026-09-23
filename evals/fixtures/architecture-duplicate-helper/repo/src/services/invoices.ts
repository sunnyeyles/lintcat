/** Invoice rules the routes rely on. */
import {
  findInvoice,
  listInvoicesForCustomer,
  type Invoice,
} from "../data/invoices.js";
import { HttpError } from "../http/errors.js";
import type { RequestContext } from "../http/request-context.js";

/** A voided invoice is reported as missing, never shown. */
export async function getInvoice(ctx: RequestContext, id: string): Promise<Invoice> {
  const invoice = await findInvoice(ctx, id);
  if (invoice === undefined || invoice.voidedAt !== null) {
    throw new HttpError(404, "invoice not found");
  }
  return invoice;
}

export async function customerInvoices(
  ctx: RequestContext,
  customerId: string,
): Promise<Invoice[]> {
  const invoices = await listInvoicesForCustomer(ctx, customerId);
  return invoices.filter((invoice) => invoice.voidedAt === null);
}
