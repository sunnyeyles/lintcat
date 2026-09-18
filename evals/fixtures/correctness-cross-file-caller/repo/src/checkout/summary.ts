/** The plain-text order summary emailed after checkout, and its webhook twin. */
import { formatCents } from "../money.js";
import { applyDiscount } from "../pricing/discount.js";
import { sumLines, type Cart } from "./cart.js";

export function renderOrderSummary(cart: Cart): string {
  const subtotal = sumLines(cart.lines);
  const lines = cart.lines.map(
    (line) =>
      `${line.quantity} x ${line.description}  ${formatCents(line.unitPriceCents * line.quantity)}`,
  );
  lines.push(`Subtotal  ${formatCents(subtotal)}`);
  lines.push(`Total     ${applyDiscount(subtotal, cart.discountCode)}`);
  return lines.join("\n");
}

/** The order.completed webhook body; the receiver validates it, we do not. */
export function orderCompletedPayload(cart: Cart): Record<string, unknown> {
  const subtotal = sumLines(cart.lines);
  return {
    order_id: cart.id,
    subtotal_cents: subtotal,
    total_cents: applyDiscount(subtotal, cart.discountCode),
  };
}
