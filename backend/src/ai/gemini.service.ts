import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ZodType } from 'zod';
import {
  GeminiPartAnalysis,
  GeminiPartAnalysisSchema,
  GeminiSceneDetection,
  GeminiSceneDetectionSchema,
  GeminiVehicleAngleSet,
  GeminiVehicleAngleSetSchema,
} from './gemini-response.schema';

export class GeminiRequestError extends Error {
  /**
   * True when the failure was upstream capacity or a transport blip rather
   * than anything wrong with the request. Callers use it to tell a worker
   * "the AI is busy, try again" instead of "that photo is bad", which are
   * very different instructions to act on.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.name = 'GeminiRequestError';
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * Statuses worth trying again. 429 is rate limiting; 500/502/503/504 are
 * upstream capacity. 503 in particular is what Gemini returns as "this
 * model is currently experiencing high demand", which is explicitly
 * temporary and is the single most common failure this service sees.
 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Per-attempt ceiling. Without one, a single overloaded upstream call can
 * hang for as long as it likes -- observed at 43 SECONDS to return a 503,
 * during which a worker stares at "Analyzing photos…" with no idea anything
 * is wrong. A vision call that is working returns in a few seconds, so this
 * is generous rather than tight.
 */
const REQUEST_TIMEOUT_MS = 45_000;

const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The yard's condition rubric, and the single source of truth for what each
 * letter means. Shared verbatim by BOTH prompts on purpose: the same part
 * must not grade differently depending on whether it was photographed
 * one-at-a-time or picked out of a walkaround shot, and two separately
 * worded copies of a rubric drift apart the first time either is edited.
 *
 * Written to the yard's own rules (2026-08-08). Two things it has to get
 * right that a looser wording did not:
 *
 * 1. A means flawless. Models gravitate to A for anything that photographs
 *    well, which quietly inflates every listing. "Any visible defect at all
 *    disqualifies A" is the line that stops that.
 * 2. C vs D is severity, not kind. Both involve real damage; the split is
 *    whether the part is still a sellable unit. That distinction is what
 *    actually drives price, so it is spelled out rather than implied.
 *
 * The tie-break rule is deliberate: for resale, over-grading causes
 * disputes and returns, under-grading only costs a little margin.
 */
export const GRADING_RUBRIC = `Grade the part's condition using EXACTLY these rules:
- "A" = perfect. No scratches, no discoloration, no dents, no cracks, nothing wrong with it at all. If you can see ANY defect, it is not an A.
- "B" = light cosmetic wear only: some scratches and/or minor discoloration or fading. Nothing bent, cracked or broken.
- "C" = damage beyond light cosmetic wear: deep or numerous scratches, heavy discoloration, a dent, a crack, or a broken piece -- but the part is still substantially intact.
- "D" = severe damage: a major dent, a break right through the part, missing or shattered sections, or deformation that would stop it being fitted.

The A/B line is any visible defect at all. The B/C line is anything worse than scratches and minor discoloration. The C/D line is severity: C is damaged but still a usable part, D is damaged enough to change what it is worth.
If a part sits genuinely between two grades, choose the lower (worse) one.`;

const GRADING_PROMPT = `You are grading a used auto part photographed at a salvage yard for resale.
Respond with strict JSON only, matching this shape exactly:
{"grade": "A" | "B" | "C" | "D", "damage_codes": string[], "confidence": number between 0 and 1}

${GRADING_RUBRIC}

damage_codes should be short lowercase tags (e.g. "scratch", "rust", "crack", "dent", "discoloration", "broken", "missing").
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
{"detections": [{"part_name": string, "grade": "A" | "B" | "C" | "D", "damage_codes": string[], "confidence": number between 0 and 1}], "image_quality": {"clarity": "clear" | "partial" | "poor", "note": string}}

Rules:
- Only list parts you can actually see well enough to grade. Do not guess at parts that are hidden, implied, or merely likely to exist on this vehicle.
- Use common salvage part names, e.g. "front bumper", "hood", "left headlight", "right fender", "windshield", "driver front door", "alternator", "radiator", "wheel".
- When a part has a left/right or front/rear variant, say which one ("left headlight", not "headlight"). If you genuinely cannot tell which side you are looking at, use the plain name without a side.
- Skip trim clips, badges, emblems, fasteners, and decorative pieces. Only parts a salvage yard would inventory and sell.
- Grade each part INDEPENDENTLY. Parts in one photo routinely differ -- an undamaged fender next to a caved-in door -- so do not let one part's condition pull the others toward it.
- damage_codes should be short lowercase tags (e.g. "scratch", "rust", "crack", "dent", "discoloration", "broken", "missing").
- confidence reflects certainty in BOTH the identification and the grade, given image quality and how much of the part is visible.

${GRADING_RUBRIC}
- image_quality describes the PHOTO, not the vehicle: "clear" = you can grade confidently, "partial" = usable but something limits it (glare, angle, distance, part of the vehicle cut off), "poor" = blurry, dark, or obstructed enough that your grades are unreliable. note is a short reason.
- A poor photo is NOT a reason to return nothing. Still report every part you can make out, with a lower confidence. Say so in image_quality and let the human decide.
- If no resellable part is clearly visible, return {"detections": []} with image_quality still filled in.`;

/**
 * Sorts a bulk photo drop into the four walkaround angles.
 *
 * Deliberately a separate, much smaller prompt than SCENE_DETECTION_PROMPT
 * rather than a field bolted onto it: this runs on every photo the worker
 * selects at the exterior step, and asking the model to also enumerate and
 * grade every visible part would cost several times as much per photo for
 * an answer nobody reads at that step. Parts are found later, by the scan.
 *
 * The `unknown` escape hatch is the important part. A worker dropping their
 * camera roll in will include interior shots, VIN plates, odometer photos
 * and 45-degree corner shots where two sides are equally visible. Forcing
 * one of four sides onto those files the photo under a side it does not
 * show; `unknown` routes it back to the human instead, which is this
 * project's standing rule for ambiguity.
 */
const VEHICLE_ANGLE_PROMPT = `You are sorting photos of ONE vehicle taken during a salvage yard walkaround.
The images follow this message in order. Image 0 is the first, image 1 the second, and so on.
Assign every image a side of the vehicle.
Respond with strict JSON only, matching this shape exactly:
{"images": [{"index": number, "angle": "front" | "rear" | "left" | "right" | "unknown", "confidence": number between 0 and 1, "note": string}]}

Rules:
- Return exactly one entry per image, and set "index" to that image's position. Do not omit an image; if you cannot tell, answer "unknown" for it.
- "front" = the front of the vehicle (grille, headlights, front bumper) seen straight on or nearly so.
- "rear" = the back (taillights, rear bumper, trunk/liftgate) seen straight on or nearly so.
- "left" = the driver's side in left-hand-drive markets, viewed from the side.
- "right" = the passenger's side in left-hand-drive markets, viewed from the side.
- Judge from the VEHICLE's own orientation, not yours. Its left is the side on the driver's left when sitting in it.
- USE THE WHOLE SET. These are all the same vehicle, so compare them: two photos showing the same damage, the same wheels or the same background are the same side, and the side opposite the one with the fuel door is the other one. A single photo you could not place alone is often obvious once you can see the rest.
- It is normal for several photos to share an angle. Do not spread them across the four sides just to use each one once.
- A three-quarter/corner shot showing two sides roughly equally is "unknown" unless one clearly dominates. Say which two in the note.
- An image that is not an exterior view at all -- an interior shot, a VIN plate, an odometer, a close-up of a single part, a document -- is "unknown". Say what it actually shows in the note.
- Do NOT guess to avoid saying "unknown". A photo filed under the wrong side is worse than one a person has to sort.
- confidence reflects certainty in that image's angle. note is a short reason, most useful when you answer "unknown".`;

/**
 * Identifies which prompt produced a prediction, for `AiAnalysis.prompt_version`.
 *
 * Part label, part content hash, deliberately. A hand-maintained version
 * string is exactly the kind that stops being bumped after the second edit,
 * and a stale one is worse than none: it would assert that two predictions
 * came from the same instructions when they did not, quietly poisoning the
 * training set this column exists to protect. Hashing the template means it
 * cannot go stale. The label is there so a human reading a row can still
 * tell at a glance which prompt it was.
 *
 * The **template** is hashed, not the text actually sent -- the VIN roster
 * is interpolated per vehicle, so hashing the final string would mint a
 * unique version per scan and make grouping impossible.
 */
function promptVersion(label: string, template: string): string {
  const digest = createHash('sha256')
    .update(template)
    .digest('hex')
    .slice(0, 8);
  return `${label}+${digest}`;
}

export const PART_GRADING_PROMPT_VERSION = promptVersion(
  'part-grading',
  GRADING_PROMPT,
);

export const SCENE_DETECTION_PROMPT_VERSION = promptVersion(
  'scene-detection',
  SCENE_DETECTION_PROMPT,
);

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

  /**
   * Classifies one walkaround photo as front/rear/left/right, or `unknown`
   * when it genuinely cannot tell. Stateless, like detectPartsInImage() --
   * it is called during intake while the vehicle is still only an IndexedDB
   * draft on the worker's phone, so there is no row to attach anything to.
   */
  async classifyVehicleAngles(
    images: { buffer: Buffer; mimeType: string }[],
  ): Promise<GeminiVehicleAngleSet> {
    return this.generateJsonMulti(
      VEHICLE_ANGLE_PROMPT,
      images,
      GeminiVehicleAngleSetSchema,
    );
  }

  private async generateJson<T>(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string,
    schema: ZodType<T>,
  ): Promise<T> {
    return this.generateJsonMulti(
      prompt,
      [{ buffer: imageBuffer, mimeType }],
      schema,
    );
  }

  /**
   * Same request path, but with several images in one call.
   *
   * Worth the extra shape for exactly one reason: some questions are far
   * easier to answer about a SET of photos than about each one alone.
   * "Which side of the car is this?" is the case in point -- a model shown
   * one photo of a wheel arch is guessing, while a model shown the whole
   * walkaround can reason relatively ("these two show the same side, and it
   * is the one opposite the photo with the fuel door").
   *
   * Images are appended after the prompt in order, so the prompt can refer
   * to them by position and the response can key back to it by index.
   */
  private async generateJsonMulti<T>(
    prompt: string,
    images: { buffer: Buffer; mimeType: string }[],
    schema: ZodType<T>,
  ): Promise<T> {
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const primary =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
    /**
     * Tried only after the primary has exhausted its retries on a
     * *retryable* failure. The aliases Google maintains are load-balanced
     * independently, so when one is saturated another is routinely fine --
     * observed directly: flash-latest timing out while flash-lite-latest
     * answered in 566ms. Unset it to disable the fallback entirely.
     */
    const fallback =
      this.config.get<string>('GEMINI_FALLBACK_MODEL') ??
      'gemini-flash-lite-latest';
    const retryBaseMs = Number(
      this.config.get<string>('GEMINI_RETRY_BASE_MS') ?? 500,
    );

    const body = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            ...images.map((image) => ({
              inline_data: {
                mime_type: image.mimeType,
                data: image.buffer.toString('base64'),
              },
            })),
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const models =
      fallback && fallback !== primary ? [primary, fallback] : [primary];
    let lastError: GeminiRequestError | null = null;

    for (const model of models) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await this.attempt(model, apiKey, body);
          return this.parse(response, schema);
        } catch (err) {
          const error =
            err instanceof GeminiRequestError
              ? err
              : new GeminiRequestError('Gemini API request failed', {
                  cause: err,
                });
          // A malformed response or a bad request will fail identically
          // however many times it is sent. Only capacity and transport
          // problems are worth waiting on.
          if (!error.retryable) throw error;
          lastError = error;
          if (attempt < MAX_ATTEMPTS) {
            await sleep(retryBaseMs * 2 ** (attempt - 1));
          }
        }
      }
    }

    throw (
      lastError ??
      new GeminiRequestError('Gemini API request failed', { retryable: true })
    );
  }

  private async attempt(
    model: string,
    apiKey: string,
    body: string,
  ): Promise<Response> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Covers both a genuine network fault and our own timeout firing.
      // Both are worth retrying and neither says anything about the photo.
      throw new GeminiRequestError('Gemini API request failed (network)', {
        cause: err,
        retryable: true,
      });
    }

    if (!response.ok) {
      throw new GeminiRequestError(
        `Gemini API request failed with status ${response.status}`,
        { retryable: RETRYABLE_STATUSES.has(response.status) },
      );
    }
    return response;
  }

  private async parse<T>(response: Response, schema: ZodType<T>): Promise<T> {
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
