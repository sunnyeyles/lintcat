export interface MapView {
  x: number;
  y: number;
  scale: number;
}

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapHandle {
  getView(): MapView;
  setView(view: MapView): void;
  fit(): void;
  centreOn(x: number, y: number, scale?: number): void;
}

export const MIN_SCALE = 0.04;
export const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function fitView(
  bounds: MapBounds,
  width: number,
  height: number,
  padding = 48,
): MapView {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clampScale(
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
  );
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}
