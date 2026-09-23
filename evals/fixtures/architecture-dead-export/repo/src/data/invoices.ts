/** Invoice reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface Invoice {
  id: string;
  tenantId: string;
  customerId: string;
  number: string;
  amountCents: number;
  currency: string;
  dueAt: string;
  paidAt: string | null;
  voidedAt: string | null;
}

const COLUMNS = `id,
       tenant_id    as "tenantId",
       customer_id  as "customerId",
       number,
       amount_cents as "amountCents",
       currency,
       due_at       as "dueAt",
       paid_at      as "paidAt",
       voided_at    as "voidedAt"`;

export async function findInvoice(
  ctx: RequestContext,
  id: string,
): Promise<Invoice | undefined> {
  const { rows } = await db.query<Invoice>(
    `select ${COLUMNS} from invoices where tenant_id = $1 and id = $2`,
    [ctx.tenantId, id],
  );
  return rows[0];
}

export async function listInvoicesForCustomer(
  ctx: RequestContext,
  customerId: string,
): Promise<Invoice[]> {
  const { rows } = await db.query<Invoice>(
    `select ${COLUMNS}
       from invoices
      where tenant_id = $1 and customer_id = $2
      order by due_at desc`,
    [ctx.tenantId, customerId],
  );
  return rows;
}

export async function listUnpaidInvoices(ctx: RequestContext): Promise<Invoice[]> {
  const { rows } = await db.query<Invoice>(
    `select ${COLUMNS}
       from invoices
      where tenant_id = $1 and paid_at is null and voided_at is null`,
    [ctx.tenantId],
  );
  return rows;
}
