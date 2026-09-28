/** Refund request reads and writes. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface RefundRequest {
  id: string;
  tenantId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  reason: string;
  requestedAt: string;
}

const COLUMNS = `id,
       tenant_id    as "tenantId",
       invoice_id   as "invoiceId",
       amount_cents as "amountCents",
       currency,
       reason,
       requested_at as "requestedAt"`;

export async function listRefundRequestsForInvoice(
  ctx: RequestContext,
  invoiceId: string,
): Promise<RefundRequest[]> {
  const { rows } = await db.query<RefundRequest>(
    `select ${COLUMNS}
       from refund_requests
      where tenant_id = $1 and invoice_id = $2
      order by requested_at asc`,
    [ctx.tenantId, invoiceId],
  );
  return rows;
}

export async function insertRefundRequest(
  ctx: RequestContext,
  invoiceId: string,
  amountCents: number,
  reason: string,
): Promise<RefundRequest> {
  const { rows } = await db.query<RefundRequest>(
    `insert into refund_requests (tenant_id, invoice_id, amount_cents, currency, reason)
     select tenant_id, id, $3, currency, $4 from invoices where tenant_id = $1 and id = $2
     returning ${COLUMNS}`,
    [ctx.tenantId, invoiceId, amountCents, reason],
  );
  return rows[0]!;
}
