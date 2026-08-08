import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ZodType } from 'zod';
import {
  GeminiPartAnalysis,
  GeminiPartAnalysisSchema,
  GeminiSceneDetection,
  GeminiSceneDetectionSchema,
} from './gemini-response.schema';

export class GeminiRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiRequestError';
  }
}

const GRADING_PROMPT = `You are grading a used auto part photographed at a salvage yard for resale.
Respond with strict JSON only, matching this shape exactly:
{"grade": "A" | "B" | "C", "damage_codes": string[], "confidence": number between 0 and 1}
"A" = like-new/minimal wear, "B" = visible wear or minor damage, "C" = significant damage.
damage_codes should be short lowercase tags (e.g. "scratch", "rust", "crack", "dent").
confidence reflects how certain you are in this grade given image quality.`;

/**
 * Multi-part counterpart to GRADING_PROMPT, for the bulk "photograph the
 * whole vehicle" flow where nobody has told us what the part is yet. Two
 * things it must get right that the single-part prompt never had to:
 *
 * 1. Side awareness. The taxonomy carries left/right variants
 *    (Fender (Left)/(Right), Headlight (Left)/(Right)), and a model that
 *    answers a bare "fender" forces TaxonomyMatcher into a coin flip. We
 *    ask for the side explicitly and let it say so when it genuinely
 *    cannot tell, which is honest and recoverable -- the worker is standing
 *    at the vehicle and can just pick.
 * 2. Restraint. Left unconstrained the model happily lists every trim clip
 *    and badge it can see, which buries the parts a yard would actually
 *    pull behind noise the worker then has to uncheck one by one.
 */
const SCENE_DETECTION_PROMPT = `You are looking at a photo of a vehicle at a salvage yard.
Identify every distinct resellable part that is CLEARLY VISIBLE in this photo, and grade each one.
Respond with strict JSON only, matching this shape exactly:
{"detections": [{"part_name": string, "grade": "A" | "B" | "C", "damage_codes": string[], "confidence": number between 0 and 1}], "image_quality": {"clarity": "clear" | "partial" | "poor", "note": string}}

Rules:
- Only list parts you can actually see well enough to grade. Do not guess at parts that are hidden, implied, or merely likely to exist on this vehicle.
- Use common salvage part names, e.g. "front bumper", "hood", "left headlight", "right fender", "windshield", "driver front door", "alternator", "radiator", "wheel".
- When a part has a left/right or front/rear variant, say which one ("left headlight", not "headlight"). If you genuinely cannot tell which side you are looking at, use the plain name without a side.
- Skip trim clips, badges, emblems, fasteners, and decorative pieces. Only parts a salvage yard would inventory and sell.
- "A" = like-new/minimal wear, "B" = visible wear or minor damage, "C" = significant damage.
- damage_codes should be short lowercase tags (e.g. "scratch", "rust", "crack", "dent").
- confidence reflects certainty in BOTH the identification and the grade, given image quality and how much of the part is visible.
- image_quality describes the PHOTO, not the vehicle: "clear" = you can grade confidently, "partial" = usable but something limits it (glare, angle, distance, part of the vehicle cut off), "poor" = blurry, dark, or obstructed enough that your grades are unreliable. note is a short reason.
- A poor photo is NOT a reason to return nothing. Still report every part you can make out, with a lower confidence. Say so in image_quality and let the human decide.
- If no resellable part is clearly visible, return {"detections": []} with image_quality still filled in.`;

/**
 * Appended when the caller knows which vehicle this is. Giving the model the
 * exact roster derived from the VIN (see vin-parts-roster.ts) does two
 * things a bare prompt cannot:
 *
 * 1. It pins the vocabulary. The model names parts in the taxonomy's own
 *    wording, so TaxonomyMatcher resolves far more of them instead of
 *    leaving "unmapped" rows a human has to file by hand.
 * 2. It rules parts out. A 2-door's roster has no rear doors, so a spurious
 *    "rear door" detection stops being possible in the first place.
 *
 * Deliberately phrased as a preference, not a hard constraint: a real part
 * that is genuinely present but missing from the roster (an aftermarket
 * addition, a part the heuristic doesn't model) must still be reportable,
 * or the scan would quietly hide it.
 */
function rosterPromptFor(expectedParts: string[]): string {
  return `

This specific vehicle is expected to have these parts, based on its VIN:
${expectedParts.map((name) => `- ${name}`).join('\n')}

When a part you can see corresponds to one of the above, use that exact wording for part_name. If you can clearly see a resellable part that is NOT in that list, still report it using a common salvage name -- the list describes what the vehicle should have, not everything it could have. Do not report a part from the list that you cannot actually see in this photo.`;
}

/**
 * Thin wrapper around Gemini's generateContent REST API (no SDK dependency —
 * this is the only call site, and response_mime_type/inline image data are
 * both plain REST features). `fetchImpl` is injectable for tests.
 *
 * Default model is gemini-flash-latest, a Google-maintained alias rather
 * than a pinned version. Chosen after two consecutive pinned defaults died
 * mid-project: gemini-2.0-flash (this file's original default) and
 * gemini-2.5-flash both now 404 with "no longer available to new users" —
 * confirmed live (2026-08-02, once GEMINI_API_KEY's billing was enabled and
 * quota was no longer 0) via a real analyzePartImage()-shaped call (inline
 * base64 image + responseMimeType: application/json) that round-tripped
 * correctly through GeminiPartAnalysisSchema. gemini-flash-latest is
 * Google's own recommended mitigation for exactly this churn. Override via
 * GEMINI_MODEL for a pinned specific version if reproducibility matters
 * more than avoiding this class of breakage.
 */
@Injectable()
export class GeminiService {
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async analyzePartImage(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<GeminiPartAnalysis> {
    return this.generateJson(
      GRADING_PROMPT,
      imageBuffer,
      mimeType,
      GeminiPartAnalysisSchema,
    );
  }

  /**
   * Bulk/photo-first counterpart to analyzePartImage(): one scene photo in,
   * every part the model can identify in it out, each already graded. Used
   * by POST /ai/detect-parts, which is stateless -- nothing here touches the
   * database, so it is safe to call during intake before the Vehicle row
   * exists.
   */
  async detectPartsInImage(
    imageBuffer: Buffer,
    mimeType: string,
    /**
     * VIN-derived roster for this vehicle, when the caller knows which
     * vehicle the photo belongs to. Omitted by the intake path, where the
     * vehicle is still only a draft on the worker's phone.
     */
    expectedParts?: string[],
  ): Promise<GeminiSceneDetection> {
    const prompt =
      expectedParts && expectedParts.length > 0
        ? SCENE_DETECTION_PROMPT + rosterPromptFor(expectedParts)
        : SCENE_DETECTION_PROMPT;
    return this.generateJson(
      prompt,
      imageBuffer,
      mimeType,
      GeminiSceneDetectionSchema,
    );
  }

  private async generateJson<T>(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string,
    schema: ZodType<T>,
  ): Promise<T> {
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const model =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBuffer.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
    } catch (err) {
      throw new GeminiRequestError('Gemini API request failed (network)', {
        cause: err,
      });
    }

    if (!response.ok) {
      throw new GeminiRequestError(
        `Gemini API request failed with status ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      throw new GeminiRequestError(
        'Gemini API returned invalid JSON envelope',
        { cause: err },
      );
    }

    const text = this.extractText(body);
    if (text === null) {
      throw new GeminiRequestError(
        'Gemini response missing expected candidates[0].content.parts[0].text',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new GeminiRequestError('Gemini response text was not valid JSON', {
        cause: err,
      });
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new GeminiRequestError(
        `Gemini response did not match the expected schema: ${result.error.message}`,
      );
    }
    return result.data;
  }

  private extractText(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) return null;
    const candidates = (body as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const first = candidates[0] as {
      content?: { parts?: { text?: unknown }[] };
    };
    const text = first.content?.parts?.[0]?.text;
    return typeof text === 'string' ? text : null;
  }
}
