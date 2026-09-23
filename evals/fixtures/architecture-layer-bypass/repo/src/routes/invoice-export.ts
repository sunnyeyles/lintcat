/** GET /customers/:customerId/invoices.csv - a customer's invoices as CSV. */
import type { Request, Response } from "express";

import { db } from "../db/pool.js";
import { requestContext } from "../http/request-context.js";

interface ExportRow {
  number: string;
  amountCents: number;
  currency: string;
  dueAt: string;
  paidAt: string | null;
}

export async function getInvoiceCsv(req: Request, res: Response): Promise<void> {
  const ctx = requestContext(req);
  const { rows } = await db.query<ExportRow>(
    `select number,
            amount_cents as "amountCents",
            currency,
            due_at       as "dueAt",
            paid_at      as "paidAt"
       from invoices
      where tenant_id = $1 and customer_id = $2
      order by due_at desc`,
    [ctx.tenantId, String(req.params["customerId"])],
  );

  const lines = ["number,amount,currency,due,paid"];
  for (const row of rows) {
    lines.push(
      [
        row.number,
        (row.amountCents / 100).toFixed(2),
        row.currency,
        row.dueAt.slice(0, 10),
        row.paidAt?.slice(0, 10) ?? "",
      ].join(","),
    );
  }
  res.type("text/csv").send(lines.join("\n"));
}
