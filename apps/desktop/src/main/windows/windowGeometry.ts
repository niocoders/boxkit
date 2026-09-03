export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface WorkArea extends WindowRect {}

export interface WindowPlacement {
  /** Fraction of the work area height used for the top offset. */
  verticalRatio?: number;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: number, fallback: number): number {
  const n = Math.round(finite(value, fallback));
  return Math.max(1, n);
}

function axisArea(origin: number, length: number): { start: number; size: number } {
  return {
    start: Math.round(finite(origin, 0)),
    size: positiveInteger(length, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Fit a DIP window size to a work area. The minimum is reduced when a
 * display is smaller than the normal minimum, so a window remains reachable.
 */
export function fitWindowSize(
  desired: WindowSize,
  workArea: WorkArea,
  minimum: WindowSize,
): WindowSize {
  const areaWidth = axisArea(workArea.x, workArea.width).size;
  const areaHeight = axisArea(workArea.y, workArea.height).size;
  const minWidth = Math.min(areaWidth, positiveInteger(minimum.width, 1));
  const minHeight = Math.min(areaHeight, positiveInteger(minimum.height, 1));
  return {
    width: clamp(positiveInteger(desired.width, minWidth), minWidth, areaWidth),
    height: clamp(positiveInteger(desired.height, minHeight), minHeight, areaHeight),
  };
}

/** Keep a window fully inside a DIP work area, including negative coordinates. */
export function clampBoundsToWorkArea(
  bounds: WindowRect,
  workArea: WorkArea,
  minimum: WindowSize,
): WindowRect {
  const areaX = axisArea(workArea.x, workArea.width);
  const areaY = axisArea(workArea.y, workArea.height);
  const size = fitWindowSize(bounds, workArea, minimum);
  return {
    x: clamp(Math.round(finite(bounds.x, areaX.start)), areaX.start, areaX.start + areaX.size - size.width),
    y: clamp(Math.round(finite(bounds.y, areaY.start)), areaY.start, areaY.start + areaY.size - size.height),
    width: size.width,
    height: size.height,
  };
}

/** Place a window near the top-center of a work area and clamp the result. */
export function placeWindowInWorkArea(
  desired: WindowSize,
  workArea: WorkArea,
  minimum: WindowSize,
  placement: WindowPlacement = {},
): WindowRect {
  const size = fitWindowSize(desired, workArea, minimum);
  const areaX = axisArea(workArea.x, workArea.width);
  const areaY = axisArea(workArea.y, workArea.height);
  const ratio = clamp(finite(placement.verticalRatio ?? 0.15, 0.15), 0, 1);
  return clampBoundsToWorkArea(
    {
      x: areaX.start + Math.round((areaX.size - size.width) / 2),
      y: areaY.start + Math.round(areaY.size * ratio),
      ...size,
    },
    workArea,
    minimum,
  );
}

export function sameWindowRect(a: WindowRect, b: WindowRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Match a persisted display id without relying on Electron at test time. */
export function findDisplayById<T extends { id: string | number }>(
  displays: T[],
  id: string | number | undefined,
): T | undefined {
  if (id === undefined) return undefined;
  return displays.find((display) => String(display.id) === String(id));
}
