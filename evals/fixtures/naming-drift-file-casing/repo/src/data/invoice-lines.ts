/** Invoice line reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface InvoiceLine {
  id: string;
  tenantId: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitCents: number;
}

const COLUMNS = `id,
       tenant_id  as "tenantId",
       invoice_id as "invoiceId",
       description,
       quantity,
       unit_cents as "unitCents"`;

export async function listInvoiceLinesForInvoice(
  ctx: RequestContext,
  invoiceId: string,
): Promise<InvoiceLine[]> {
  const { rows } = await db.query<InvoiceLine>(
    `select ${COLUMNS}
       from invoice_lines
      where tenant_id = $1 and invoice_id = $2
      order by position asc`,
    [ctx.tenantId, invoiceId],
  );
  return rows;
}
