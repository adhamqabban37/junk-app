import { analyzeImageQuality } from "./image-quality";
import type { QualityFlags } from "./types";

export interface CaptureResult {
  blob: Blob;
  qualityFlags: QualityFlags;
}

/**
 * Draws the current video frame to an offscreen canvas, runs the (unit-tested)
 * quality analysis on the raw pixels, and produces a JPEG blob. Needs a real
 * <video>/<canvas> (no canvas 2D context in jsdom), so this function itself
 * isn't unit-tested — it's kept as a thin seam around analyzeImageQuality,
 * which is.
 */
export async function captureFrame(video: HTMLVideoElement): Promise<CaptureResult> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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
