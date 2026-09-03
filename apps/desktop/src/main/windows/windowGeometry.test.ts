import { describe, expect, it } from "vitest";
import {
  clampBoundsToWorkArea,
  findDisplayById,
  fitWindowSize,
  placeWindowInWorkArea,
} from "./windowGeometry.js";

describe("window geometry", () => {
  it("clamps a window on a negative-coordinate display", () => {
    const workArea = { x: -1920, y: -120, width: 1920, height: 1080 };
    expect(clampBoundsToWorkArea({ x: -2400, y: -600, width: 900, height: 700 }, workArea, { width: 480, height: 260 })).toEqual({
      x: -1920,
      y: -120,
      width: 900,
      height: 700,
    });
  });

  it("clamps a window that extends past the right and bottom edges", () => {
    const workArea = { x: 0, y: 40, width: 1280, height: 680 };
    expect(clampBoundsToWorkArea({ x: 1000, y: 700, width: 500, height: 300 }, workArea, { width: 480, height: 260 })).toEqual({
      x: 780,
      y: 420,
      width: 500,
      height: 300,
    });
  });

  it("fits search dimensions to a small work area", () => {
    expect(fitWindowSize({ width: 802, height: 418 }, { x: 0, y: 0, width: 600, height: 300 }, { width: 480, height: 260 })).toEqual({
      width: 600,
      height: 300,
    });
  });

  it("places a window on a display above the primary display", () => {
    expect(placeWindowInWorkArea({ width: 800, height: 400 }, { x: 0, y: -900, width: 1600, height: 900 }, { width: 480, height: 260 }, { verticalRatio: 0.15 })).toEqual({
      x: 400,
      y: -765,
      width: 800,
      height: 400,
    });
  });

  it("matches display ids across Electron number/string representations", () => {
    expect(findDisplayById([{ id: 7 }, { id: 8 }], "8")).toEqual({ id: 8 });
    expect(findDisplayById([{ id: 7 }], "9")).toBeUndefined();
  });
});
