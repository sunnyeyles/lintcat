/** Payment reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  receivedAt: string;
}

const COLUMNS = `id,
       tenant_id    as "tenantId",
       invoice_id   as "invoiceId",
       amount_cents as "amountCents",
       currency,
       received_at  as "receivedAt"`;

export async function findPayment(
  ctx: RequestContext,
  id: string,
): Promise<Payment | undefined> {
  const { rows } = await db.query<Payment>(
    `select ${COLUMNS} from payments where tenant_id = $1 and id = $2`,
    [ctx.tenantId, id],
  );
  return rows[0];
}

export async function listPaymentsForInvoice(
  ctx: RequestContext,
  invoiceId: string,
): Promise<Payment[]> {
  const { rows } = await db.query<Payment>(
    `select ${COLUMNS}
       from payments
      where tenant_id = $1 and invoice_id = $2
      order by received_at asc`,
    [ctx.tenantId, invoiceId],
  );
  return rows;
}
