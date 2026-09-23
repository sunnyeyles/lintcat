/** The overdue invoices collections should chase, oldest aging band first. */
import { listUnpaidInvoices, type Invoice } from "../data/invoices.js";
import type { RequestContext } from "../http/request-context.js";
import { agingBucket, type AgingBucket } from "../lib/dates.js";

export interface CollectionItem {
  invoice: Invoice;
  bucket: AgingBucket;
}

const BUCKET_ORDER: readonly AgingBucket[] = ["90+", "61-90", "31-60", "1-30"];

export async function collectionQueue(
  ctx: RequestContext,
  now: Date,
): Promise<CollectionItem[]> {
  const invoices = await listUnpaidInvoices(ctx);
  return invoices
    .map((invoice) => ({ invoice, bucket: agingBucket(invoice.dueAt, now) }))
    .filter((item) => item.bucket !== "current")
    .sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket));
}
