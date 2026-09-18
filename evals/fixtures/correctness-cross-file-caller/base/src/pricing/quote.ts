/** The priced quote the storefront shows before payment. */
import { formatCents } from "../money.js";
import { applyDiscount } from "./discount.js";

export interface Quote {
  subtotalCents: number;
  totalCents: number;
  /** The total, formatted for the price panel. */
  display: string;
}

export function buildQuote(subtotalCents: number, code: string | null): Quote {
  const totalCents = applyDiscount(subtotalCents, code);
  return {
    subtotalCents,
    totalCents,
    display: formatCents(totalCents),
  };
}
