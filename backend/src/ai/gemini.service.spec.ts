import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  GeminiRequestError,
  GeminiService,
  GRADING_RUBRIC,
  PART_GRADING_PROMPT_VERSION,
  SCENE_DETECTION_PROMPT_VERSION,
} from './gemini.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiEnvelope(analysisJson: Record<string, unknown>): unknown {
  return {
    candidates: [
      { content: { parts: [{ text: JSON.stringify(analysisJson) }] } },
    ],
  };
}

describe('GeminiService', () => {
  function makeService(
    fetchImpl: typeof fetch,
    overrides: Record<string, string> = {},
  ): GeminiService {
    const config = new ConfigService({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-2.0-flash',
      // Real backoff would make every retry test sleep for seconds.
      GEMINI_RETRY_BASE_MS: '0',
      ...overrides,
    });
    return new GeminiService(config, fetchImpl);
  }

  /** The prompt text actually sent to Gemini on the Nth call. */
  function promptFrom(fetchMock: jest.Mock, call = 0): string {
    const [, options] = fetchMock.mock.calls[call] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as {
      contents: { parts: { text?: string }[] }[];
    };
    return body.contents[0].parts.find((p) => p.text)?.text ?? '';
  }

  describe('grading rubric', () => {
    it('accepts a D grade end to end', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            grade: 'D',
            damage_codes: ['broken', 'dent'],
            confidence: 0.88,
          }),
        ),
      );

      const result = await makeService(fetchMock).analyzePartImage(
        Buffer.from('fake-jpeg'),
        'image/jpeg',
      );

      expect(result.grade).toBe('D');
      expect(result.damage_codes).toEqual(['broken', 'dent']);
    });

    it('accepts a D grade from scene detection too', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            detections: [
              {
                part_name: 'front bumper',
                grade: 'D',
                damage_codes: ['broken'],
                confidence: 0.9,
              },
            ],
          }),
        ),
      );

      const result = await makeService(fetchMock).detectPartsInImage(
        Buffer.from('fake-jpeg'),
        'image/jpeg',
      );

      expect(result.detections[0].grade).toBe('D');
    });

    // The same part must not grade differently depending on whether it was
    // photographed alone or picked out of a walkaround shot. Two separately
    // worded copies of a rubric drift the first time either is edited, so
    // both prompts embed the one constant.
    it('sends the identical rubric in both the single-part and scene prompts', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            geminiEnvelope({ grade: 'A', damage_codes: [], confidence: 0.9 }),
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse(geminiEnvelope({ detections: [] })),
        );

      const service = makeService(fetchMock);
      await service.analyzePartImage(Buffer.from('x'), 'image/jpeg');
      await service.detectPartsInImage(Buffer.from('x'), 'image/jpeg');

      expect(promptFrom(fetchMock, 0)).toContain(GRADING_RUBRIC);
      expect(promptFrom(fetchMock, 1)).toContain(GRADING_RUBRIC);
    });

    // These are the yard's actual rules, and the boundaries are where a
    // model will otherwise drift -- especially the A rule, since models
    // gravitate to A for anything that photographs well.
    it('states all four grades and the boundaries between them', () => {
      expect(GRADING_RUBRIC).toContain('"A" = perfect');
      expect(GRADING_RUBRIC).toContain('"B" = light cosmetic wear only');
      expect(GRADING_RUBRIC).toContain(
        '"C" = damage beyond light cosmetic wear',
      );
      expect(GRADING_RUBRIC).toContain('"D" = severe damage');
      // Any visible defect disqualifies an A.
      expect(GRADING_RUBRIC).toMatch(/ANY defect, it is not an A/);
      // C vs D is severity, not kind.
      expect(GRADING_RUBRIC).toMatch(/C is damaged but still a usable part/);
      // Ties resolve downward: over-grading causes disputes, under-grading
      // only costs margin.
      expect(GRADING_RUBRIC).toMatch(/choose the lower \(worse\) one/);
    });
  });

  it('parses a well-formed Gemini response into a validated analysis', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        geminiEnvelope({
          grade: 'A',
          damage_codes: ['scratch'],
          confidence: 0.92,
        }),
      ),
    );

    const service = makeService(fetchMock);
    const result = await service.analyzePartImage(
      Buffer.from('fake-jpeg'),
      'image/jpeg',
    );

    expect(result).toEqual({
      grade: 'A',
      damage_codes: ['scratch'],
      confidence: 0.92,
    });
  });

  it('sends response_mime_type: application/json and the image as inline base64 data', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          geminiEnvelope({ grade: 'B', damage_codes: [], confidence: 0.5 }),
        ),
      );

    const service = makeService(fetchMock);
    await service.analyzePartImage(Buffer.from('fake-jpeg'), 'image/jpeg');

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-2.0-flash');
    expect(url).toContain('key=test-key');
    const body = JSON.parse(options.body as string) as {
      generationConfig: { responseMimeType: string };
      contents: {
        parts: { inline_data?: { mime_type: string; data: string } }[];
      }[];
    };
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const inlineData = body.contents[0].parts.find(
      (p) => p.inline_data,
    )?.inline_data;
    expect(inlineData?.mime_type).toBe('image/jpeg');
    expect(inlineData?.data).toBe(Buffer.from('fake-jpeg').toString('base64'));
  });

  it('throws GeminiRequestError on a non-2xx response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}, 503));
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
  });

  it('throws GeminiRequestError when the network request itself fails', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
  });

  it('throws GeminiRequestError when the response text is not valid JSON, without storing it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'not json' }] } }],
      }),
    );
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
  });

  it('throws GeminiRequestError when the parsed JSON does not match the expected schema', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(
        geminiEnvelope({
          grade: 'Z',
          damage_codes: 'not-an-array',
          confidence: 5,
        }),
      ),
    );
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
  });

  it('throws GeminiRequestError when the response has no candidates text at all', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(jsonResponse({ candidates: [] }));
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
  });

  // These end up on AiAnalysis.prompt_version and are the provenance the
  // correction dataset is trained against. The property that matters is not
  // what the string says -- it is that it CANNOT silently stop tracking the
  // prompt, which is what a hand-maintained version number always
  // eventually does.
  describe('prompt versions', () => {
    it('labels each prompt distinguishably', () => {
      expect(PART_GRADING_PROMPT_VERSION).toMatch(
        /^part-grading\+[0-9a-f]{8}$/,
      );
      expect(SCENE_DETECTION_PROMPT_VERSION).toMatch(
        /^scene-detection\+[0-9a-f]{8}$/,
      );
    });

    it('gives the two prompts different versions', () => {
      expect(PART_GRADING_PROMPT_VERSION).not.toBe(
        SCENE_DETECTION_PROMPT_VERSION,
      );
    });

    // Both prompts embed GRADING_RUBRIC, so editing the rubric changes both
    // digests. That is the whole point: a rubric change IS a prompt change,
    // and predictions from either side of it must not be pooled as though
    // they came from the same instructions.
    it('derives the digest from the prompt text, so editing the rubric changes it', () => {
      const digestOf = (v: string) => v.split('+')[1];
      const rubricDigest = createHash('sha256')
        .update(GRADING_RUBRIC)
        .digest('hex')
        .slice(0, 8);

      // Not the rubric's own digest -- the full prompt's, which contains it.
      expect(digestOf(PART_GRADING_PROMPT_VERSION)).not.toBe(rubricDigest);
      expect(digestOf(PART_GRADING_PROMPT_VERSION)).toHaveLength(8);
    });
  });
});

// Gemini returns 503 "this model is currently experiencing high demand"
// under load, and it is explicitly temporary. Before this, one 503 meant a
// worker's whole scan failed -- and because there was no timeout either,
// each call took up to 43 seconds to fail, so ten photos spent minutes
// producing nothing.
describe('GeminiService transient failures', () => {
  function makeService(
    fetchImpl: typeof fetch,
    overrides: Record<string, string> = {},
  ): GeminiService {
    const config = new ConfigService({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'primary-model',
      GEMINI_RETRY_BASE_MS: '0',
      ...overrides,
    });
    return new GeminiService(config, fetchImpl);
  }

  const ok = () =>
    jsonResponse(
      geminiEnvelope({
        grade: 'B',
        damage_codes: ['scratch'],
        confidence: 0.8,
      }),
    );

  function modelOf(fetchMock: jest.Mock, call: number): string {
    const [url] = fetchMock.mock.calls[call] as [string];
    return /models\/([^:]+):/.exec(url)?.[1] ?? '';
  }

  it('retries a 503 and succeeds without troubling the caller', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(ok());
    const service = makeService(fetchMock);

    const result = await service.analyzePartImage(
      Buffer.from('x'),
      'image/jpeg',
    );

    expect(result.grade).toBe('B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // A 400 means the request itself is wrong. Sending it again wastes the
  // worker's time and Google's quota to get the identical answer.
  it('does not retry a 400', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}, 400));
    const service = makeService(fetchMock);

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(GeminiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Observed live: flash-latest timed out at 30s while flash-lite-latest
  // answered in 566ms. The aliases are balanced independently, so a
  // saturated one is not evidence the account or the key is the problem.
  it('falls back to the secondary model once the primary is exhausted', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('primary-model') ? jsonResponse({}, 503) : ok(),
        ),
      );
    const service = makeService(fetchMock, {
      GEMINI_FALLBACK_MODEL: 'backup-model',
    });

    const result = await service.analyzePartImage(
      Buffer.from('x'),
      'image/jpeg',
    );

    expect(result.grade).toBe('B');
    expect(modelOf(fetchMock, 0)).toBe('primary-model');
    expect(modelOf(fetchMock, 3)).toBe('backup-model');
  });

  it('marks an exhausted transient failure as retryable so callers can say so', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({}, 503));
    const service = makeService(fetchMock, {
      GEMINI_FALLBACK_MODEL: '',
    });

    await expect(
      service.analyzePartImage(Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ retryable: true });
  });
});
