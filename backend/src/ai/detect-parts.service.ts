import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PartTaxonomy } from '../database/entities';
import { GeminiService } from './gemini.service';
import { sniffImageMime } from './image-type';
import { TaxonomyMatcher } from './taxonomy-matcher';

export interface DetectedPart {
  /** Raw free text from Gemini, kept so the UI can show what it actually saw. */
  partName: string;
  /** Null when unmapped or ambiguous -- the worker resolves those. */
  taxonomyId: string | null;
  taxonomyName: string | null;
  /** Populated when ambiguous (>1) so the UI can offer just those choices. */
  candidateIds: string[];
  grade: 'A' | 'B' | 'C';
  damageCodes: string[];
  confidence: number;
}

export interface DetectedImage {
  /** Upload order, so the client can pair results back to its local photo. */
  index: number;
  detections: DetectedPart[];
  /** Set when this one image failed; its siblings still return normally. */
  error?: string;
  /**
   * The model's own read on how usable the photo was. Undefined when it
   * didn't say. A `poor` photo still carries whatever detections it managed
   * -- this is a warning to show the human, never a reason to discard.
   */
  clarity?: 'clear' | 'partial' | 'poor';
  clarityNote?: string;
}

/**
 * Gemini calls per batch run at this concurrency. Salvage intake batches are
 * small (a walkaround is ~4-8 photos) and the worker is actively waiting, so
 * this trades a little latency for staying well clear of per-minute rate
 * limits -- one 429 in the middle of a batch is worse for them than a few
 * extra seconds.
 */
const CONCURRENCY = 3;

@Injectable()
export class DetectPartsService {
  private readonly logger = new Logger(DetectPartsService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly matcher: TaxonomyMatcher,
    @InjectRepository(PartTaxonomy)
    private readonly taxonomyRepo: Repository<PartTaxonomy>,
  ) {}

  /**
   * Stateless: reads the shared taxonomy, calls Gemini per image, maps the
   * free-text results onto taxonomy rows, and returns. Writes nothing.
   *
   * That is the whole reason this can be called during intake -- at that
   * point the worker's vehicle exists only as an IndexedDB draft on their
   * phone, so there is no Vehicle or Part row to attach anything to. The
   * confirmed results go into the draft client-side and reach the database
   * later through the existing POST /vehicles/intake path.
   */
  async detect(
    files: Pick<Express.Multer.File, 'buffer'>[],
    /**
     * VIN-derived roster, when scanning a vehicle that already exists. Two
     * effects: it is fed to the model to pin its vocabulary, and it
     * constrains taxonomy matching so a part the vehicle cannot have (rear
     * doors on a coupe) is never offered as a candidate. Omitted by the
     * intake path, which has no vehicle yet.
     */
    expectedParts?: string[],
  ): Promise<{ images: DetectedImage[] }> {
    const allTaxonomies = await this.taxonomyRepo.find();
    // Matching is restricted to the roster when we have one. Anything the
    // model reports outside it still comes back -- as unmapped, for a human
    // to file -- rather than being silently forced onto a nearby row.
    const taxonomies =
      expectedParts && expectedParts.length > 0
        ? allTaxonomies.filter((t) => expectedParts.includes(t.name))
        : allTaxonomies;
    const images: DetectedImage[] = new Array<DetectedImage>(files.length);

    for (let start = 0; start < files.length; start += CONCURRENCY) {
      const slice = files.slice(start, start + CONCURRENCY);
      const settled = await Promise.allSettled(
        slice.map((file) =>
          this.gemini.detectPartsInImage(
            file.buffer,
            // Sniffed, not declared: a client-supplied mimetype that
            // disagrees with the actual bytes makes Gemini reject the whole
            // call. The controller has already rejected anything that
            // sniffs to null, so the fallback here is unreachable in
            // practice and exists only to keep this total.
            sniffImageMime(file.buffer) ?? 'image/jpeg',
            expectedParts,
          ),
        ),
      );

      settled.forEach((outcome, offset) => {
        const index = start + offset;
        if (outcome.status === 'rejected') {
          // One unreadable photo must not cost the worker the other seven.
          // They get an empty result for this image and can retake it.
          this.logger.warn(
            `Scene detection failed for image ${index}: ${String(
              outcome.reason,
            )}`,
          );
          images[index] = {
            index,
            detections: [],
            error: 'Could not analyze this photo',
          };
          return;
        }

        const names = outcome.value.detections.map((d) => d.part_name);
        const resolved = this.matcher.resolveAll(names, taxonomies);
        images[index] = {
          index,
          clarity: outcome.value.image_quality?.clarity,
          clarityNote: outcome.value.image_quality?.note,
          detections: outcome.value.detections.map((d) => {
            const match = resolved.get(d.part_name);
            return {
              partName: d.part_name,
              taxonomyId: match?.taxonomyId ?? null,
              taxonomyName: match?.taxonomyName ?? null,
              candidateIds: match?.candidateIds ?? [],
              grade: d.grade,
              damageCodes: d.damage_codes,
              confidence: d.confidence,
            };
          }),
        };
      });
    }

    return { images };
  }
}
