/** Product catalogue reads. Every query is scoped to the caller's tenant. */
import { query } from "../db/pool.js";
import type { RequestContext } from "../context.js";

export interface ProductRecord {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  category: string;
}

const PRODUCT_COLUMNS = `id,
       tenant_id as "tenantId",
       sku,
       name,
       category`;

/** The tenant's catalogue, alphabetically. */
export async function listProducts(ctx: RequestContext): Promise<ProductRecord[]> {
  return query<ProductRecord>(
    `select ${PRODUCT_COLUMNS}
       from products
      where tenant_id = $1
      order by name asc`,
    [ctx.tenantId],
  );
}
