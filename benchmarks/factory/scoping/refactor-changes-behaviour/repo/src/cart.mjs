import { formatPrice } from "./prices.mjs";

export function cartLine(item) {
  return `${item.name}: ${formatPrice(item.cents)}`;
}
