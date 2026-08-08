/**
 * Image formats Gemini's inline_data accepts. HEIC/HEIF matter in practice:
 * it is the iPhone camera default, so a yard worker's photos routinely
 * arrive in it.
 */
export type SniffedImageMime =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

/**
 * Identifies an image by its magic bytes rather than its declared mimetype.
 *
 * Two reasons not to trust the client's Content-Type here. It is often
 * simply absent or `application/octet-stream` (curl, PowerShell, some
 * native HTTP clients), which would reject perfectly good photos; and when
 * it IS present it can disagree with the actual bytes, in which case
 * forwarding it to Gemini gets the whole call rejected for a mismatch. The
 * bytes are the only thing that is actually true.
 *
 * Returns null when the buffer is not a supported image, which is also the
 * upload guard -- no Gemini call gets billed for a PDF.
 */
export function sniffImageMime(buffer: Buffer): SniffedImageMime | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // HEIC/HEIF: ISO-BMFF box, "ftyp" at offset 4, brand at offset 8.
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (
      ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)
    ) {
      return 'image/heic';
    }
  }

  return null;
}
