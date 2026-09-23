/** The overdue invoices collections should chase, most overdue first. */
import { listUnpaidInvoices, type Invoice } from "../data/invoices.js";
import type { RequestContext } from "../http/request-context.js";
import { daysOverdue } from "../lib/dates.js";

export interface CollectionItem {
  invoice: Invoice;
  daysOverdue: number;
}

export async function collectionQueue(
  ctx: RequestContext,
  now: Date,
): Promise<CollectionItem[]> {
  const invoices = await listUnpaidInvoices(ctx);
  return invoices
    .map((invoice) => ({ invoice, daysOverdue: daysOverdue(invoice.dueAt, now) }))
    .filter((item) => item.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}
