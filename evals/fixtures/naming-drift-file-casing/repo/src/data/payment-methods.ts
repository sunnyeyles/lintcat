/** Payment method reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface PaymentMethod {
  id: string;
  tenantId: string;
  customerId: string;
  brand: string;
  last4: string;
  expiresAt: string;
}

const COLUMNS = `id,
       tenant_id   as "tenantId",
       customer_id as "customerId",
       brand,
       last4,
       expires_at  as "expiresAt"`;

export async function findPaymentMethod(
  ctx: RequestContext,
  id: string,
): Promise<PaymentMethod | undefined> {
  const { rows } = await db.query<PaymentMethod>(
    `select ${COLUMNS} from payment_methods where tenant_id = $1 and id = $2`,
    [ctx.tenantId, id],
  );
  return rows[0];
}

export async function listPaymentMethodsForCustomer(
  ctx: RequestContext,
  customerId: string,
): Promise<PaymentMethod[]> {
  const { rows } = await db.query<PaymentMethod>(
    `select ${COLUMNS}
       from payment_methods
      where tenant_id = $1 and customer_id = $2
      order by expires_at desc`,
    [ctx.tenantId, customerId],
  );
  return rows;
}
