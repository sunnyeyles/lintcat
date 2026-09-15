import type { ChartColors } from "./use-chart-colors";

export const TICK_FONT_SIZE = 10.5;

export function gridProps(colors: ChartColors) {
  return {
    stroke: colors.ruleSoft,
    strokeWidth: 1,
    vertical: false,
  } as const;
}

export function tickProps(colors: ChartColors) {
  return { fill: colors.slate, fontSize: TICK_FONT_SIZE } as const;
}

export function axisLineProps(colors: ChartColors) {
  return { stroke: colors.rule, strokeWidth: 1 } as const;
}

export function cursorProps(colors: ChartColors) {
  return { stroke: colors.rule, strokeWidth: 1 } as const;
}

export function barCursorProps(colors: ChartColors) {
  return { fill: colors.surface2, fillOpacity: 0.7 } as const;
}
