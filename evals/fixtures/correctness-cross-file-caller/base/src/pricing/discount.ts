/** The one place a promotional code is turned into money off a subtotal. */
import { percentOf } from "../money.js";
import { findDiscountCode } from "./codes.js";

/** The discounted total in cents. */
export function applyDiscount(
  subtotalCents: number,
  code: string | null,
): number {
  if (code === null) {
    return subtotalCents;
  }
  const discount = findDiscountCode(code);
  if (discount === null || subtotalCents < discount.minimumCents) {
    return subtotalCents;
  }
  return subtotalCents - percentOf(subtotalCents, discount.percent);
}
