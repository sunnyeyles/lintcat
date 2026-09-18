/** The cart as the checkout session holds it. */

export interface CartLine {
  sku: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Cart {
  id: string;
  lines: readonly CartLine[];
  discountCode: string | null;
}

export function sumLines(lines: readonly CartLine[]): number {
  return lines.reduce(
    (total, line) => total + line.unitPriceCents * line.quantity,
    0,
  );
}
