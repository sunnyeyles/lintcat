// The film's palette: LintCat brand tokens first (packages/design/src/brand.css), then working tints.
export const PALETTE = [
  "#F5EFE3", // 0 paper: the ground
  "#E4DCCC", // 1 sand: card faces, panels
  "#1E2D42", // 2 navy: the cat, ink, captions
  "#4A5B72", // 3 slate: code bars, leaders
  "#9AA6B8", // 4 stone: faint bars, unlit strip words
  "#3AA693", // 5 turquoise: nose, whiskers, pass stamp, buttons
  "#1D5C5A", // 6 teal: the gate, verified borders
  "#F47B4E", // 7 coral: pupils, line markers, cross
  "#C4552C", // 8 rust: dropped-card text and strike
  "#C5E3C7", // 9 mint: added lines
  "#F0B848", // 10 amber: the webhook bolt, the job token
  "#FFFFFF", // 11 white: eye whites
];

export const C = { paper: 0, sand: 1, navy: 2, slate: 3, stone: 4, turquoise: 5, teal: 6, coral: 7, rust: 8, mint: 9, amber: 10, white: 11 } as const;

// Rec. 601 luma per entry: the gate measures change on a greyscale downscale, so contrast is what counts.
export const LUMA = PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return Math.round(0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
});
