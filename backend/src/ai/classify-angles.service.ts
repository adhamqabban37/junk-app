import { Injectable, Logger } from '@nestjs/common';
import { sniffImageMime } from './image-type';
import { GeminiRequestError, GeminiService } from './gemini.service';

/** One photo's classification, positionally matched to the uploaded files. */
export interface ClassifiedImage {
  index: number;
  /**
   * `unknown` when the model could not tell, when the photo is not an
   * exterior view at all, or when the call failed outright. Never a guess --
   * a photo filed under the wrong side of the car is worse than one a
   * person has to sort, and the worker is standing at the vehicle.
   */
  angle: 'front' | 'rear' | 'left' | 'right' | 'unknown';
  confidence: number;
  note: string | null;
  /** Present only when the call itself failed, so the UI can say so. */
  error?: string;
}

/**
 * How many photos go into one Gemini call.
 *
 * Unlike part detection, this is deliberately NOT one call per photo. The
 * question "which side of the car is this?" is far easier to answer about a
 * set than about a single frame -- the model can see that two photos share
 * the same dent and are therefore the same side, and that the side without
 * the fuel door is the other one. A model shown one close-up of a wheel arch
 * in isolation is guessing, which is exactly what it was doing before.
 *
 * Chunked rather than unbounded because the images are base64-inlined into
 * the request body, so a 24-photo walkaround in one call would be a very
 * large POST. 12 keeps a typical walkaround (4-10 photos) in a single call
 * and therefore fully cross-referenced, while bounding the worst case.
 *
 * Side benefit worth naming: this also cuts the cost of the step from one
 * call per photo to one call per chunk.
 */
const CHUNK_SIZE = 12;

/**
 * Sorts a bulk drop of walkaround photos into front/rear/left/right.
 *
 * Stateless, exactly like DetectPartsService and for the same reason: this
 * runs during intake, when the vehicle exists only as an IndexedDB draft on
 * the worker's phone. There is no Vehicle row to attach a VehicleImage to,
 * so this writes nothing -- the angles it returns are applied to the draft
 * client-side and reach the database later through POST /vehicles/intake.
 */
@Injectable()
export class ClassifyAnglesService {
  private readonly logger = new Logger(ClassifyAnglesService.name);

  constructor(private readonly gemini: GeminiService) {}

  async classify(
    files: Pick<Express.Multer.File, 'buffer'>[],
  ): Promise<{ images: ClassifiedImage[] }> {
    // Start every photo as unknown. Anything the model omits, or a chunk
    // that fails outright, therefore falls back to "a person sorts this"
    // rather than to a wrong angle or a missing entry.
    const images: ClassifiedImage[] = files.map((_, index) => ({
      index,
      angle: 'unknown' as const,
      confidence: 0,
      note: null,
    }));

    for (let start = 0; start < files.length; start += CHUNK_SIZE) {
      const chunk = files.slice(start, start + CHUNK_SIZE);
      try {
        const result = await this.gemini.classifyVehicleAngles(
          chunk.map((file) => ({
            buffer: file.buffer,
            // Sniffed, not declared -- a mimetype that disagrees with the
            // actual bytes makes Gemini reject the call. The controller has
            // already rejected anything sniffing to null, so this fallback
            // is unreachable and exists only to keep the expression total.
            mimeType: sniffImageMime(file.buffer) ?? 'image/jpeg',
          })),
        );

        for (const entry of result.images) {
          // The model echoes back an index into THIS chunk. Ignore anything
          // out of range instead of trusting it -- a hallucinated index
          // would otherwise write an angle onto an unrelated photo, and a
          // wrong side is the one outcome worse than no answer.
          if (entry.index < 0 || entry.index >= chunk.length) continue;
          images[start + entry.index] = {
            index: start + entry.index,
            angle: entry.angle,
            confidence: entry.confidence,
            note: entry.note ?? null,
          };
        }
      } catch (err) {
        // A failed chunk costs only its own photos, and they stay as
        // `unknown` for the worker to assign rather than being lost.
        this.logger.warn(
          `Angle classification failed for images ${start}-${start + chunk.length - 1}: ${String(err)}`,
        );
        for (let i = start; i < start + chunk.length; i += 1) {
          images[i] = {
            ...images[i],
            error:
              err instanceof GeminiRequestError && err.retryable
                ? 'The AI is busy right now — try again in a moment'
                : 'Could not analyze this photo',
          };
        }
      }
    }

    return { images };
  }
}
