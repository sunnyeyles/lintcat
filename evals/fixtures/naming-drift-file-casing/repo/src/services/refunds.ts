/** Refund rules the routes rely on. */
import {
  insertRefundRequest,
  listRefundRequestsForInvoice,
  type RefundRequest,
} from "../data/refundRequests.js";
import { HttpError } from "../http/errors.js";
import type { RequestContext } from "../http/request-context.js";
import { getInvoice } from "./invoices.js";

/** A customer may ask for at most what they were invoiced, across every request. */
export async function requestRefund(
  ctx: RequestContext,
  invoiceId: string,
  amountCents: number,
  reason: string,
): Promise<RefundRequest> {
  const invoice = await getInvoice(ctx, invoiceId);
  const earlier = await listRefundRequestsForInvoice(ctx, invoiceId);
  const requested = earlier.reduce((sum, request) => sum + request.amountCents, 0);
  if (amountCents <= 0 || requested + amountCents > invoice.amountCents) {
    throw new HttpError(422, "refund exceeds the invoiced amount");
  }
  return insertRefundRequest(ctx, invoiceId, amountCents, reason);
}
