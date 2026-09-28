/** Payment rules the routes rely on. */
import { findInvoice } from "../data/invoices.js";
import { findPayment, type Payment } from "../data/payments.js";
import type { RequestContext } from "../http/request-context.js";

/** A payment against a voided invoice is hidden, like the invoice itself. */
export async function getPayment(
  ctx: RequestContext,
  id: string,
): Promise<Payment | undefined> {
  const payment = await findPayment(ctx, id);
  if (payment === undefined) {
    return undefined;
  }
  const invoice = await findInvoice(ctx, payment.invoiceId);
  if (invoice === undefined || invoice.voidedAt !== null) {
    return undefined;
  }
  return payment;
}
