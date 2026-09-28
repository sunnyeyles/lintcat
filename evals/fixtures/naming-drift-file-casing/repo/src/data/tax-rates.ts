/** Tax rate reads. Every query is scoped to the caller's tenant. */
import { db } from "../db/pool.js";
import type { RequestContext } from "../http/request-context.js";

export interface TaxRate {
  id: string;
  tenantId: string;
  region: string;
  basisPoints: number;
}

const COLUMNS = `id,
       tenant_id    as "tenantId",
       region,
       basis_points as "basisPoints"`;

export async function findTaxRate(
  ctx: RequestContext,
  region: string,
): Promise<TaxRate | undefined> {
  const { rows } = await db.query<TaxRate>(
    `select ${COLUMNS} from tax_rates where tenant_id = $1 and region = $2`,
    [ctx.tenantId, region],
  );
  return rows[0];
}
