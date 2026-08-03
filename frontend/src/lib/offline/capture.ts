import { analyzeImageQuality } from "./image-quality";
import type { QualityFlags } from "./types";

export interface CaptureResult {
  blob: Blob;
  qualityFlags: QualityFlags;
}

async function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<CaptureResult> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const qualityFlags = analyzeImageQuality(imageData);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("canvas.toBlob failed"))),
      "image/jpeg",
      0.9,
    );
  });

  return { blob, qualityFlags };
}

/**
 * Alternative to captureFrame() for a photo picked from the file system or
 * dropped in, rather than pulled live from getUserMedia. Re-draws through
 * the same canvas pipeline (not just re-using the file's own bytes) so
 * uploaded photos get the identical blur/lighting analysis and a
 * consistent JPEG output regardless of source format. Needs a real
 * <canvas> + createImageBitmap (neither exists in jsdom), so -- like
 * captureFrame -- this isn't unit-tested directly; component tests mock it.
 */
export async function captureFromFile(file: File): Promise<CaptureResult> {
  const bitmap = await createImageBitmap(file);
  try {
    return await drawToCanvas(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Draws the current video frame to an offscreen canvas, runs the (unit-tested)
 * quality analysis on the raw pixels, and produces a JPEG blob. Needs a real
 * <video>/<canvas> (no canvas 2D context in jsdom), so this function itself
 * isn't unit-tested — it's kept as a thin seam around analyzeImageQuality,
 * which is.
 */
export async function captureFrame(video: HTMLVideoElement): Promise<CaptureResult> {
  return drawToCanvas(video, video.videoWidth, video.videoHeight);
}
