import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GeminiPartAnalysis,
  GeminiPartAnalysisSchema,
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
 * Thin wrapper around Gemini's generateContent REST API (no SDK dependency —
 * this is the only call site, and response_mime_type/inline image data are
 * both plain REST features). `fetchImpl` is injectable for tests.
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
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    const model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.5-flash';
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
                { text: GRADING_PROMPT },
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

    const result = GeminiPartAnalysisSchema.safeParse(parsed);
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
