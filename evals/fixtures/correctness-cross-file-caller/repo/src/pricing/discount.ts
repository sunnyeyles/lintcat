/** The one place a promotional code is turned into money off a subtotal. */
import { percentOf } from "../money.js";
import { findDiscountCode } from "./codes.js";

/** The discounted total, and how much the code took off; both in cents. */
export interface DiscountResult {
  total: number;
  applied: number;
}

export function applyDiscount(
  subtotalCents: number,
  code: string | null,
): DiscountResult {
  if (code === null) {
    return { total: subtotalCents, applied: 0 };
  }
  const discount = findDiscountCode(code);
  if (discount === null || subtotalCents < discount.minimumCents) {
    return { total: subtotalCents, applied: 0 };
  }
  const applied = percentOf(subtotalCents, discount.percent);
  return { total: subtotalCents - applied, applied };
}
