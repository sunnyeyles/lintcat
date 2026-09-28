/** Customer reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  createdAt: string;
}

const COLUMNS = `id,
       tenant_id  as "tenantId",
       name,
       email,
       created_at as "createdAt"`;

export async function findCustomer(
  ctx: RequestContext,
  id: string,
): Promise<Customer | undefined> {
  const { rows } = await db.query<Customer>(
    `select ${COLUMNS} from customers where tenant_id = $1 and id = $2`,
    [ctx.tenantId, id],
  );
  return rows[0];
}

export async function listCustomers(ctx: RequestContext): Promise<Customer[]> {
  const { rows } = await db.query<Customer>(
    `select ${COLUMNS}
       from customers
      where tenant_id = $1
      order by name asc`,
    [ctx.tenantId],
  );
  return rows;
}
