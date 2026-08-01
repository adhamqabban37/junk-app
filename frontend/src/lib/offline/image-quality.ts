import type { QualityFlags } from "./types";

export interface RawImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Laplacian variance below this = edgeless = out of focus. Mean grayscale
// luminance (0-255) below this = underexposed. Both tuned against the
// synthetic fixtures in image-quality.test.ts, not a real photo corpus —
// revisit once real camera captures are available (Phase 3 acceptance).
const BLUR_VARIANCE_THRESHOLD = 100;
const DARK_MEAN_LUMINANCE_THRESHOLD = 40;

function toGrayscale({ data, width, height }: RawImageData): Float64Array {
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}

function laplacianVariance(gray: Float64Array, width: number, height: number): number {
  const laplacians: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const value =
        -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width];
      laplacians.push(value);
    }
  }
  if (laplacians.length === 0) {
    // No interior pixels to measure edges on — treat as blurry rather than
    // throwing; a degenerate frame this small can't prove it's in focus.
    return 0;
  }
  const mean = laplacians.reduce((sum, v) => sum + v, 0) / laplacians.length;
  return laplacians.reduce((sum, v) => sum + (v - mean) ** 2, 0) / laplacians.length;
}

function meanLuminance(gray: Float64Array): number {
  return gray.reduce((sum, v) => sum + v, 0) / gray.length;
}

/** Pure pixel-data analysis, deliberately decoupled from canvas/video capture so it's unit-testable without a browser. */
export function analyzeImageQuality(image: RawImageData): QualityFlags {
  const gray = toGrayscale(image);
  return {
    blurry: laplacianVariance(gray, image.width, image.height) < BLUR_VARIANCE_THRESHOLD,
    tooDark: meanLuminance(gray) < DARK_MEAN_LUMINANCE_THRESHOLD,
  };
}
