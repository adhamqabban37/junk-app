import { describe, expect, it } from "vitest";
import { analyzeImageQuality, type RawImageData } from "./image-quality";

/** Uniform single-color fixture — zero edge variance, i.e. maximally "blurry". */
function makeFlatImage(width: number, height: number, [r, g, b]: [number, number, number]): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** Alternating-pixel checkerboard fixture — high edge variance, i.e. "sharp". */
function makeCheckerboardImage(width: number, height: number, low: number, high: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = (x + y) % 2 === 0 ? low : high;
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("analyzeImageQuality", () => {
  it("flags a uniform (edgeless) well-lit frame as blurry but not dark", () => {
    const flags = analyzeImageQuality(makeFlatImage(32, 32, [200, 200, 200]));
    expect(flags).toEqual({ blurry: true, tooDark: false });
  });

  it("flags a uniform near-black frame as both blurry and dark", () => {
    const flags = analyzeImageQuality(makeFlatImage(32, 32, [10, 10, 10]));
    expect(flags).toEqual({ blurry: true, tooDark: true });
  });

  it("does not flag a high-contrast, well-lit checkerboard as blurry or dark", () => {
    const flags = analyzeImageQuality(makeCheckerboardImage(32, 32, 0, 255));
    expect(flags).toEqual({ blurry: false, tooDark: false });
  });

  it("flags a sharp but dim checkerboard as dark without flagging it as blurry", () => {
    const flags = analyzeImageQuality(makeCheckerboardImage(32, 32, 0, 60));
    expect(flags).toEqual({ blurry: false, tooDark: true });
  });

  it("degrades gracefully on a frame too small to have interior pixels, rather than throwing", () => {
    expect(() => analyzeImageQuality(makeFlatImage(2, 2, [128, 128, 128]))).not.toThrow();
    const flags = analyzeImageQuality(makeFlatImage(2, 2, [128, 128, 128]));
    expect(flags.blurry).toBe(true);
  });
});
