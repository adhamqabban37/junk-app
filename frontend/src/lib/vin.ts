const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;

/** I, O, and Q are never valid VIN characters (avoids confusion with 1/0). */
export function isValidVinFormat(value: string): boolean {
  return VIN_PATTERN.test(value.trim());
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) {
    return null;
  }
  return (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
}

/** BarcodeDetector is Chromium/Android-only (not Safari/Firefox) — callers must offer manual VIN entry regardless. */
export function isBarcodeScanSupported(): boolean {
  return getBarcodeDetectorCtor() !== null;
}

/** VIN barcodes are typically Code 39 or Code 128. Returns the first detected value that is a plausible VIN, or null. */
export async function scanVinFromImage(source: ImageBitmapSource): Promise<string | null> {
  const Ctor = getBarcodeDetectorCtor();
  if (!Ctor) {
    return null;
  }
  const detector = new Ctor({ formats: ["code_39", "code_128"] });
  const results = await detector.detect(source);
  for (const result of results) {
    const candidate = result.rawValue.trim().toUpperCase();
    if (isValidVinFormat(candidate)) {
      return candidate;
    }
  }
  return null;
}
