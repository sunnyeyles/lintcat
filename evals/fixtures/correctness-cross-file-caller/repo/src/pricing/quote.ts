/** The priced quote the storefront shows before payment. */
import { formatCents } from "../money.js";
import { applyDiscount } from "./discount.js";

export interface Quote {
  subtotalCents: number;
  totalCents: number;
  savedCents: number;
  /** The total, formatted for the price panel. */
  display: string;
}

export function buildQuote(subtotalCents: number, code: string | null): Quote {
  const { total, applied } = applyDiscount(subtotalCents, code);
  return {
    subtotalCents,
    totalCents: total,
    savedCents: applied,
    display: formatCents(total),
  };
}
