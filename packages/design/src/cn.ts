import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Mirrors the scale names in theme.css, or `text-caption` would be merged away as a colour.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "label", "body", "lede", "h3", "h2", "h1"],
      radius: ["xs", "sm", "md"],
      tracking: ["display", "ui", "caps"],
      container: ["measure"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
