/** The promotional codes the storefront honours. */

export interface DiscountCode {
  code: string;
  percent: number;
  /** Below this subtotal the code does not apply at all. */
  minimumCents: number;
}

const CODES: readonly DiscountCode[] = [
  { code: "WELCOME10", percent: 10, minimumCents: 2_000 },
  { code: "SPRING15", percent: 15, minimumCents: 5_000 },
  { code: "BULK25", percent: 25, minimumCents: 25_000 },
];

export function findDiscountCode(code: string): DiscountCode | null {
  const upper = code.trim().toUpperCase();
  return CODES.find((entry) => entry.code === upper) ?? null;
}
