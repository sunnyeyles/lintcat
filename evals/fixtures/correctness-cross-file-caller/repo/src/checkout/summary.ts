/** What the checkout page shows before the customer pays. */
import { addMoney, money, type Money } from "../pricing/money.js";
import {
  quoteShipment,
  type ShipmentRequest,
  type ShippingQuote,
} from "../pricing/quote.js";

export interface BasketLine {
  sku: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface CheckoutSummary {
  itemCount: number;
  goods: Money;
  shipping: ShippingQuote;
}

export async function buildCheckoutSummary(
  lines: readonly BasketLine[],
  currency: string,
  request: ShipmentRequest,
): Promise<CheckoutSummary> {
  const goods = lines.reduce(
    (total, line) =>
      addMoney(total, money(line.unitPriceMinor * line.quantity, currency)),
    money(0, currency),
  );
  return {
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    goods,
    shipping: await quoteShipment(request),
  };
}
