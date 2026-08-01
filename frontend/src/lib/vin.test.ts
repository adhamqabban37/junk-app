import { afterEach, describe, expect, it, vi } from "vitest";
import { isBarcodeScanSupported, isValidVinFormat, scanVinFromImage } from "./vin";

describe("isValidVinFormat", () => {
  it("accepts a well-formed 17-character VIN", () => {
    expect(isValidVinFormat("1HGCM82633A123456")).toBe(true);
  });

  it("rejects VINs that are the wrong length", () => {
    expect(isValidVinFormat("1HGCM82633A12345")).toBe(false);
    expect(isValidVinFormat("1HGCM82633A1234567")).toBe(false);
  });

  it("rejects VINs containing I, O, or Q (never valid per the VIN spec)", () => {
    expect(isValidVinFormat("1HGCM8263IA123456")).toBe(false);
    expect(isValidVinFormat("1HGCM8263OA123456")).toBe(false);
    expect(isValidVinFormat("1HGCM8263QA123456")).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isValidVinFormat(" 1hgcm82633a123456 ")).toBe(true);
  });
});

describe("isBarcodeScanSupported", () => {
  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of a global we stub below
    delete window.BarcodeDetector;
  });

  it("is false when the browser has no BarcodeDetector", () => {
    expect(isBarcodeScanSupported()).toBe(false);
  });

  it("is true when BarcodeDetector is present", () => {
    // @ts-expect-error -- minimal stub, full API not needed for this check
    window.BarcodeDetector = class {};
    expect(isBarcodeScanSupported()).toBe(true);
  });
});

describe("scanVinFromImage", () => {
  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of a global we stub below
    delete window.BarcodeDetector;
  });

  it("returns null when the browser doesn't support barcode detection", async () => {
    const result = await scanVinFromImage({} as ImageBitmapSource);
    expect(result).toBeNull();
  });

  it("returns the first detected value that is a valid VIN, skipping non-VIN barcodes", async () => {
    const detect = vi.fn().mockResolvedValue([
      { rawValue: "not-a-vin" },
      { rawValue: "1hgcm82633a123456" },
    ]);
    // @ts-expect-error -- minimal stub, full API not needed for this test
    window.BarcodeDetector = class {
      detect = detect;
    };

    const result = await scanVinFromImage({} as ImageBitmapSource);
    expect(result).toBe("1HGCM82633A123456");
  });

  it("returns null when nothing detected matches VIN format", async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: "garbage" }]);
    // @ts-expect-error -- minimal stub, full API not needed for this test
    window.BarcodeDetector = class {
      detect = detect;
    };

    const result = await scanVinFromImage({} as ImageBitmapSource);
    expect(result).toBeNull();
  });
});
