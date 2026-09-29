/** Credit note reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface CreditNote {
  id: string;
  tenantId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  reason: string;
  issuedAt: string;
}

const COLUMNS = `id,
       tenant_id    as "tenantId",
       invoice_id   as "invoiceId",
       amount_cents as "amountCents",
       currency,
       reason,
       issued_at    as "issuedAt"`;

export async function findCreditNote(
  ctx: RequestContext,
  id: string,
): Promise<CreditNote | undefined> {
  const { rows } = await db.query<CreditNote>(
    `select ${COLUMNS} from credit_notes where tenant_id = $1 and id = $2`,
    [ctx.tenantId, id],
  );
  return rows[0];
}

export async function listCreditNotesForInvoice(
  ctx: RequestContext,
  invoiceId: string,
): Promise<CreditNote[]> {
  const { rows } = await db.query<CreditNote>(
    `select ${COLUMNS}
       from credit_notes
      where tenant_id = $1 and invoice_id = $2
      order by issued_at asc`,
    [ctx.tenantId, invoiceId],
  );
  return rows;
}
