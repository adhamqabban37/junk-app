import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import {
  GeminiPartAnalysis,
  GeminiPartAnalysisSchema,
  GeminiVehicleAnalysis,
  GeminiVehicleAnalysisSchema,
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

function buildVehicleGradingPrompt(candidateParts: string[]): string {
  return `You are grading the overall condition of a vehicle at a salvage yard, from a batch of its photos. There may be as few as 1 photo -- grade based on whatever is shown, do not ask for more. The photos given are all of the same general area of the vehicle (e.g. all front-of-vehicle shots, or all driver-side shots) and are listed in the order they were captured -- photos taken back-to-back are more likely to be different angles of the very same physical part, not different parts.

You are also identifying every distinct part visible in each individual photo -- this can be an exterior part (bumper, fender, headlight, etc.) or an interior part actually visible in the photo (seat, dashboard, steering wheel, etc.). A single photo often shows more than one of these at once (e.g. a 3/4 front angle can show a headlight, the front bumper, and a fender all together) -- identify all of them, not just the most obvious one. Only choose from this exact list of part names -- do not invent your own names, do not paraphrase:
${candidateParts.map((p) => `- ${p}`).join('\n')}

For each photo (0-based index), list one entry per distinct part from that list clearly visible in it -- a photo can produce several entries (one per part shown) or zero entries (e.g. an engine/undercarriage shot with nothing from the list visible, or too unclear/zoomed to tell). Never list the same part twice for the same photo.

Additionally, assign every entry a group_id (a small integer, starting at 0): entries that show the SAME physical part instance -- e.g. two different angles of one specific fender -- must share the same group_id. Entries for a different physical instance of even the same part type (e.g. the driver-side headlight vs. the passenger-side headlight) must get different group_ids. Every entry needs a group_id, even one that's the only photo of its part -- just give it its own number nobody else shares. Only decide grouping using the photos given in this one request; you have no information about any other batch.

Respond with strict JSON only, matching this shape exactly:
{"grade": "A" | "B" | "C", "damage_codes": string[], "confidence": number between 0 and 1, "photo_suggestions": [{"photo_index": number, "suggested_part": string, "confidence": number, "group_id": number}]}
"A" = like-new/minimal wear, "B" = visible wear or moderate damage, "C" = significant/severe damage.
damage_codes should be short lowercase tags describing what you see (e.g. "rust", "collision damage", "missing panel", "flood damage").
confidence (top-level) reflects how certain you are in the overall grade given image quality and how much of the vehicle the photos actually show -- fewer or lower-quality photos should lower confidence, not block a grade.
photo_suggestions is a flat list across all photos -- omit a photo entirely rather than including it with no parts.`;
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
    return this.callGemini(
      GRADING_PROMPT,
      [{ buffer: imageBuffer, mimeType }],
      GeminiPartAnalysisSchema,
    );
  }

  /**
   * Same grading response shape as analyzePartImage plus a per-photo
   * exterior-part suggestion, scored for a whole vehicle from 1+ photos in
   * a single request (Gemini accepts multiple inline_data parts in one
   * call) instead of one part from exactly one photo. `candidateParts` is
   * the exact list of exterior-visual taxonomy names Gemini is allowed to
   * suggest from -- any returned name not in that list is normalized to
   * null (never trust a free-text match against real DB rows without
   * verifying it).
   */
  async analyzeVehiclePhotos(
    images: { buffer: Buffer; mimeType: string }[],
    candidateParts: string[],
  ): Promise<GeminiVehicleAnalysis> {
    const result = await this.callGemini(
      buildVehicleGradingPrompt(candidateParts),
      images,
      GeminiVehicleAnalysisSchema,
    );
    const candidateSet = new Set(candidateParts);
    return {
      ...result,
      photo_suggestions: result.photo_suggestions.map((s) =>
        s.suggested_part !== null && !candidateSet.has(s.suggested_part)
          ? { ...s, suggested_part: null }
          : s,
      ),
    };
  }

  private async callGemini<T>(
    promptText: string,
    images: { buffer: Buffer; mimeType: string }[],
    schema: z.ZodType<T>,
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
                { text: promptText },
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
