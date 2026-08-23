import { ConfigService } from '@nestjs/config';
import { GeminiRequestError, GeminiService } from './gemini.service';

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
  function makeService(fetchImpl: typeof fetch): GeminiService {
    const config = new ConfigService({
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-2.0-flash',
    });
    return new GeminiService(config, fetchImpl);
  }

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

  describe('analyzeVehiclePhotos', () => {
    it('sends every image as its own inline_data part in one request', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            grade: 'B',
            damage_codes: [],
            confidence: 0.7,
            photo_suggestions: [
              {
                photo_index: 0,
                suggested_part: null,
                confidence: 0,
                group_id: 0,
              },
              {
                photo_index: 1,
                suggested_part: null,
                confidence: 0,
                group_id: 1,
              },
            ],
          }),
        ),
      );
      const service = makeService(fetchMock);

      await service.analyzeVehiclePhotos(
        [
          { buffer: Buffer.from('photo-1'), mimeType: 'image/jpeg' },
          { buffer: Buffer.from('photo-2'), mimeType: 'image/jpeg' },
        ],
        ['Bumper Assy Front'],
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        contents: {
          parts: { text?: string; inline_data?: { data: string } }[];
        }[];
      };
      const inlineDataValues = body.contents[0].parts
        .filter((p) => p.inline_data)
        .map((p) => p.inline_data?.data);
      expect(inlineDataValues).toEqual([
        Buffer.from('photo-1').toString('base64'),
        Buffer.from('photo-2').toString('base64'),
      ]);
      // The candidate list must actually reach the prompt -- Gemini can
      // only pick from names it's told about.
      expect(body.contents[0].parts[0].text).toContain('Bumper Assy Front');
    });

    it('works from a single photo -- never requires more than one', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            grade: 'C',
            damage_codes: ['rust'],
            confidence: 0.4,
            photo_suggestions: [
              {
                photo_index: 0,
                suggested_part: null,
                confidence: 0,
                group_id: 0,
              },
            ],
          }),
        ),
      );
      const service = makeService(fetchMock);

      const result = await service.analyzeVehiclePhotos(
        [{ buffer: Buffer.from('only-photo'), mimeType: 'image/jpeg' }],
        [],
      );

      expect(result).toEqual({
        grade: 'C',
        damage_codes: ['rust'],
        confidence: 0.4,
        photo_suggestions: [
          { photo_index: 0, suggested_part: null, confidence: 0, group_id: 0 },
        ],
      });
    });

    it('normalizes a suggested_part that is not in the candidate list to null -- never trusts free text against real DB rows', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            grade: 'B',
            damage_codes: [],
            confidence: 0.6,
            photo_suggestions: [
              {
                photo_index: 0,
                suggested_part: 'Something Gemini Made Up',
                confidence: 0.9,
                group_id: 0,
              },
            ],
          }),
        ),
      );
      const service = makeService(fetchMock);

      const result = await service.analyzeVehiclePhotos(
        [{ buffer: Buffer.from('photo'), mimeType: 'image/jpeg' }],
        ['Bumper Assy Front', 'Fender'],
      );

      expect(result.photo_suggestions).toEqual([
        { photo_index: 0, suggested_part: null, confidence: 0.9, group_id: 0 },
      ]);
    });

    it('keeps a suggested_part that exactly matches a real candidate', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse(
          geminiEnvelope({
            grade: 'A',
            damage_codes: [],
            confidence: 0.85,
            photo_suggestions: [
              {
                photo_index: 0,
                suggested_part: 'Fender',
                confidence: 0.8,
                group_id: 0,
              },
            ],
          }),
        ),
      );
      const service = makeService(fetchMock);

      const result = await service.analyzeVehiclePhotos(
        [{ buffer: Buffer.from('photo'), mimeType: 'image/jpeg' }],
        ['Bumper Assy Front', 'Fender'],
      );

      expect(result.photo_suggestions).toEqual([
        {
          photo_index: 0,
          suggested_part: 'Fender',
          confidence: 0.8,
          group_id: 0,
        },
      ]);
    });
  });
});
