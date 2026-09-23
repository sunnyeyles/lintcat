/** The payment-reminder email for an overdue invoice. */
import type { Invoice } from "../data/invoices.js";

export interface ReminderEmail {
  subject: string;
  text: string;
}

function formatAmount(cents: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  return formatter.format(cents / 100);
}

export function reminderEmail(invoice: Invoice): ReminderEmail {
  const amount = formatAmount(invoice.amountCents, invoice.currency);
  const due = invoice.dueAt.slice(0, 10);
  return {
    subject: `Invoice ${invoice.number} is overdue`,
    text:
      `Invoice ${invoice.number} for ${amount} was due on ${due}.\n\n` +
      "If you have already paid, please ignore this email.",
  };
}
