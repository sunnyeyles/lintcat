// A drawing from docs/explainer, bundled into public/explainer/<id>.js by `pnpm explainer`.
export type Drawing = {
  title: string;
  G: number;
  H: number;
  fps: number;
  frames: number;
  palettes: { light: string[]; dark: string[] };
  /** Each op is `cell * 16 + palette index`, in the order the drawing lays them. */
  ops: () => number[];
  /** How many ops are laid by frame `f`. */
  at: (f: number) => number;
};

export type Painter = Pick<CanvasRenderingContext2D, "fillRect"> & { fillStyle: CanvasRenderingContext2D["fillStyle"] };

// Rounded cell edges tile the canvas exactly: every cell is whole device pixels, none antialiased.
export const edges = (cells: number, px: number) => Array.from({ length: cells + 1 }, (_, i) => Math.round((i * px) / cells));

export function replay(grid: Uint8Array, ops: number[], from: number, to: number) {
  for (let k = from; k < to; k++) grid[ops[k] >> 4] = ops[k] & 15;
}

export function paint(ctx: Painter, grid: Uint8Array, G: number, H: number, palette: string[], width: number, height: number) {
  const xs = edges(G, width), ys = edges(H, height);
  for (let y = 0; y < H; y++) {
    const top = ys[y], h = ys[y + 1] - top;
    if (h === 0) continue;
    for (let x = 0; x < G; ) {
      const c = grid[y * G + x];
      let e = x + 1;
      while (e < G && grid[y * G + e] === c) e++;
      ctx.fillStyle = palette[c];
      ctx.fillRect(xs[x], top, xs[e] - xs[x], h);
      x = e;
    }
  }
}

// theme.css sets color-scheme from data-color-mode, so this follows both the toggle and `auto`.
export const colourMode = (root: Element): "light" | "dark" => (getComputedStyle(root).colorScheme.includes("dark") ? "dark" : "light");
