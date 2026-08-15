import { ClassifyAnglesService } from './classify-angles.service';
import { GeminiRequestError, GeminiService } from './gemini.service';
import { GeminiVehicleAngleSet } from './gemini-response.schema';

/** Minimal JPEG magic bytes, so sniffImageMime() sees a real image. */
function jpeg(marker = 0): Pick<Express.Multer.File, 'buffer'> {
  return { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, marker]) };
}

function makeService(
  classify: (
    images: { buffer: Buffer; mimeType: string }[],
  ) => Promise<GeminiVehicleAngleSet>,
): { service: ClassifyAnglesService; calls: jest.Mock } {
  const calls = jest.fn(classify);
  const gemini = { classifyVehicleAngles: calls } as unknown as GeminiService;
  return { service: new ClassifyAnglesService(gemini), calls };
}

describe('ClassifyAnglesService', () => {
  // The whole reason this is one call rather than one per photo: the model
  // can only tell that two shots are the same side of the car if it can see
  // them together.
  it('sends the whole walkaround in a single call', async () => {
    const { service, calls } = makeService(() =>
      Promise.resolve({
        images: [
          { index: 0, angle: 'front', confidence: 0.9 },
          { index: 1, angle: 'left', confidence: 0.8 },
          { index: 2, angle: 'rear', confidence: 0.85 },
        ],
      }),
    );

    const { images } = await service.classify([jpeg(1), jpeg(2), jpeg(3)]);

    expect(calls).toHaveBeenCalledTimes(1);
    expect(images.map((i) => i.angle)).toEqual(['front', 'left', 'rear']);
  });

  it('matches results by the index the model returns, not by array order', async () => {
    const { service } = makeService(() =>
      Promise.resolve({
        images: [
          { index: 2, angle: 'rear', confidence: 0.9 },
          { index: 0, angle: 'front', confidence: 0.9 },
        ],
      }),
    );

    const { images } = await service.classify([jpeg(1), jpeg(2), jpeg(3)]);

    expect(images[0].angle).toBe('front');
    expect(images[2].angle).toBe('rear');
  });

  // A model that returns fewer entries than there were photos must not
  // shift every later angle onto the wrong image. The gap stays unknown.
  it('leaves a photo the model skipped as unknown', async () => {
    const { service } = makeService(() =>
      Promise.resolve({
        images: [
          { index: 0, angle: 'front', confidence: 0.9 },
          { index: 2, angle: 'rear', confidence: 0.9 },
        ],
      }),
    );

    const { images } = await service.classify([jpeg(1), jpeg(2), jpeg(3)]);

    expect(images).toHaveLength(3);
    expect(images[1]).toMatchObject({ index: 1, angle: 'unknown' });
    expect(images[2].angle).toBe('rear');
  });

  // A hallucinated index would otherwise stamp an angle onto an unrelated
  // photo, and a confidently wrong side is worse than no answer at all.
  it('ignores an out-of-range index instead of trusting it', async () => {
    const { service } = makeService(() =>
      Promise.resolve({
        images: [
          { index: 0, angle: 'front', confidence: 0.9 },
          { index: 99, angle: 'left', confidence: 0.9 },
        ],
      }),
    );

    const { images } = await service.classify([jpeg(1), jpeg(2)]);

    expect(images).toHaveLength(2);
    expect(images[0].angle).toBe('front');
    expect(images[1].angle).toBe('unknown');
  });

  it('falls back to unknown with an error when the call fails', async () => {
    const { service } = makeService(() =>
      Promise.reject(new GeminiRequestError('boom')),
    );

    const { images } = await service.classify([jpeg(1), jpeg(2)]);

    expect(images).toHaveLength(2);
    expect(images.every((i) => i.angle === 'unknown')).toBe(true);
    expect(images[0].error).toBe('Could not analyze this photo');
  });

  it('passes through an unknown angle with the model reason and no error', async () => {
    const { service } = makeService(() =>
      Promise.resolve({
        images: [
          {
            index: 0,
            angle: 'unknown' as const,
            confidence: 0.3,
            note: 'interior shot, no exterior visible',
          },
        ],
      }),
    );

    const { images } = await service.classify([jpeg()]);

    expect(images[0].note).toBe('interior shot, no exterior visible');
    // The model answered successfully; it just answered "unknown". The UI
    // must not tell the worker something went wrong.
    expect(images[0].error).toBeUndefined();
  });

  it('chunks a batch larger than the per-call limit', async () => {
    const { service, calls } = makeService((imgs) =>
      Promise.resolve({
        images: imgs.map((_, i) => ({
          index: i,
          angle: 'right' as const,
          confidence: 0.7,
        })),
      }),
    );

    const { images } = await service.classify(
      Array.from({ length: 15 }, (_, i) => jpeg(i)),
    );

    expect(calls).toHaveBeenCalledTimes(2);
    expect(images).toHaveLength(15);
    expect(images.every((i) => i.angle === 'right')).toBe(true);
    expect(images.map((i) => i.index)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    );
  });
});
