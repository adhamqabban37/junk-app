import { Repository } from 'typeorm';
import { PartTaxonomy } from '../database/entities';
import { DetectPartsService } from './detect-parts.service';
import { GeminiService } from './gemini.service';
import { GeminiRequestError } from './gemini.service';
import { TaxonomyMatcher } from './taxonomy-matcher';

const TAXONOMY: PartTaxonomy[] = [
  { id: 'tax-hood', name: 'Hood', category: 'Body', isQuickPick: true },
  {
    id: 'tax-bumper-front',
    name: 'Bumper (Front)',
    category: 'Body',
    isQuickPick: true,
  },
  {
    id: 'tax-headlight-left',
    name: 'Headlight (Left)',
    category: 'Lighting',
    isQuickPick: true,
  },
  {
    id: 'tax-headlight-right',
    name: 'Headlight (Right)',
    category: 'Lighting',
    isQuickPick: true,
  },
];

const file = (name: string): Express.Multer.File =>
  ({
    buffer: Buffer.from(name),
    mimetype: 'image/jpeg',
    originalname: name,
  }) as Express.Multer.File;

const detection = (partName: string, grade: 'A' | 'B' | 'C' = 'B') => ({
  part_name: partName,
  grade,
  damage_codes: ['scratch'],
  confidence: 0.9,
});

describe('DetectPartsService', () => {
  let gemini: { detectPartsInImage: jest.Mock };
  let service: DetectPartsService;

  beforeEach(() => {
    gemini = { detectPartsInImage: jest.fn() };
    service = new DetectPartsService(
      gemini as unknown as GeminiService,
      new TaxonomyMatcher(),
      {
        find: jest.fn().mockResolvedValue(TAXONOMY),
      } as unknown as Repository<PartTaxonomy>,
    );
  });

  it('maps every detection in a photo onto taxonomy rows', async () => {
    gemini.detectPartsInImage.mockResolvedValue({
      detections: [detection('hood', 'A'), detection('front bumper', 'C')],
    });

    const result = await service.detect([file('a.jpg')]);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].detections).toEqual([
      expect.objectContaining({
        partName: 'hood',
        taxonomyId: 'tax-hood',
        taxonomyName: 'Hood',
        grade: 'A',
      }),
      expect.objectContaining({
        partName: 'front bumper',
        taxonomyId: 'tax-bumper-front',
        grade: 'C',
      }),
    ]);
  });

  it('keeps an ambiguous detection unresolved and offers its candidates', async () => {
    gemini.detectPartsInImage.mockResolvedValue({
      detections: [detection('headlight')],
    });

    const [image] = (await service.detect([file('a.jpg')])).images;

    expect(image.detections[0].taxonomyId).toBeNull();
    expect(image.detections[0].candidateIds).toEqual(
      expect.arrayContaining(['tax-headlight-left', 'tax-headlight-right']),
    );
  });

  it('keeps an unmapped detection with its grade instead of dropping it', async () => {
    // A dropped detection is invisible to the worker -- they would never
    // know the AI saw a windshield at all.
    gemini.detectPartsInImage.mockResolvedValue({
      detections: [detection('windshield', 'A')],
    });

    const [image] = (await service.detect([file('a.jpg')])).images;

    expect(image.detections).toHaveLength(1);
    expect(image.detections[0]).toEqual(
      expect.objectContaining({
        partName: 'windshield',
        taxonomyId: null,
        candidateIds: [],
        grade: 'A',
      }),
    );
  });

  it('lets one failed photo fail alone, preserving upload order', async () => {
    gemini.detectPartsInImage
      .mockResolvedValueOnce({ detections: [detection('hood')] })
      .mockRejectedValueOnce(new GeminiRequestError('boom'))
      .mockResolvedValueOnce({ detections: [detection('front bumper')] });

    const result = await service.detect([
      file('a.jpg'),
      file('b.jpg'),
      file('c.jpg'),
    ]);

    expect(result.images.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(result.images[0].detections[0].taxonomyId).toBe('tax-hood');
    expect(result.images[1].error).toBe('Could not analyze this photo');
    expect(result.images[1].detections).toEqual([]);
    expect(result.images[2].detections[0].taxonomyId).toBe('tax-bumper-front');
  });

  it('handles a photo with nothing resellable in it', async () => {
    gemini.detectPartsInImage.mockResolvedValue({ detections: [] });

    const [image] = (await service.detect([file('a.jpg')])).images;

    expect(image.detections).toEqual([]);
    expect(image.error).toBeUndefined();
  });

  it('reads the taxonomy once per batch, not once per photo', async () => {
    const taxonomyRepo = { find: jest.fn().mockResolvedValue(TAXONOMY) };
    service = new DetectPartsService(
      gemini as unknown as GeminiService,
      new TaxonomyMatcher(),
      taxonomyRepo as unknown as Repository<PartTaxonomy>,
    );
    gemini.detectPartsInImage.mockResolvedValue({ detections: [] });

    await service.detect([file('a.jpg'), file('b.jpg'), file('c.jpg')]);

    expect(taxonomyRepo.find).toHaveBeenCalledTimes(1);
  });

  it('processes batches larger than the concurrency limit', async () => {
    gemini.detectPartsInImage.mockResolvedValue({
      detections: [detection('hood')],
    });

    const files = Array.from({ length: 7 }, (_, i) => file(`${i}.jpg`));
    const result = await service.detect(files);

    expect(result.images).toHaveLength(7);
    expect(gemini.detectPartsInImage).toHaveBeenCalledTimes(7);
    expect(result.images.every((i) => i.detections.length === 1)).toBe(true);
  });
});
