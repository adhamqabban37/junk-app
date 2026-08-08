import { PartTaxonomy } from '../database/entities';
import { TaxonomyMatcher } from './taxonomy-matcher';

/**
 * Mirrors the real seeded taxonomy (taxonomy.seed.ts) rather than a
 * convenient subset -- the ambiguity this class exists to handle only shows
 * up when the left/right sibling rows are actually present.
 */
const SEED: Array<[string, string]> = [
  ['Alternator', 'Engine'],
  ['Starter Motor', 'Engine'],
  ['Engine (Complete)', 'Engine'],
  ['Transmission', 'Drivetrain'],
  ['Radiator', 'Cooling'],
  ['Bumper (Front)', 'Body'],
  ['Bumper (Rear)', 'Body'],
  ['Door (Driver Front)', 'Body'],
  ['Door (Passenger Front)', 'Body'],
  ['Hood', 'Body'],
  ['Trunk Lid', 'Body'],
  ['Fender (Left)', 'Body'],
  ['Fender (Right)', 'Body'],
  ['Headlight (Left)', 'Lighting'],
  ['Headlight (Right)', 'Lighting'],
  ['Taillight (Left)', 'Lighting'],
  ['Taillight (Right)', 'Lighting'],
  ['Mirror (Left)', 'Body'],
  ['Mirror (Right)', 'Body'],
  ['Wheel/Rim', 'Wheels & Tires'],
  ['Seat (Driver)', 'Interior'],
  ['Seat (Passenger)', 'Interior'],
  ['Door (Driver Rear)', 'Body'],
  ['Door (Passenger Rear)', 'Body'],
  ['Quarter Panel (Left)', 'Body'],
  ['Quarter Panel (Right)', 'Body'],
  ['Rocker Panel (Left)', 'Body'],
  ['Rocker Panel (Right)', 'Body'],
  ['Grille', 'Body'],
  ['Liftgate/Tailgate', 'Body'],
  ['Windshield', 'Glass'],
  ['Rear Window', 'Glass'],
  ['Sunroof', 'Glass'],
];

const taxonomies: PartTaxonomy[] = SEED.map(([name, category], i) => ({
  id: `id-${i}`,
  name,
  category,
  isQuickPick: false,
}));

const byName = (name: string): string =>
  taxonomies.find((t) => t.name === name)!.id;

describe('TaxonomyMatcher', () => {
  const matcher = new TaxonomyMatcher();

  const resolve = (name: string) =>
    matcher.resolveAll([name], taxonomies).get(name)!;

  describe('unambiguous identity', () => {
    it.each([
      ['hood', 'Hood'],
      ['the hood', 'Hood'],
      ['bonnet', 'Hood'],
      ['alternator', 'Alternator'],
      ['radiator', 'Radiator'],
      ['transmission', 'Transmission'],
      ['gearbox', 'Transmission'],
      ['starter motor', 'Starter Motor'],
      ['wheel', 'Wheel/Rim'],
      ['rim', 'Wheel/Rim'],
      ['alloy wheel', 'Wheel/Rim'],
      ['trunk lid', 'Trunk Lid'],
      ['boot lid', 'Trunk Lid'],
    ])('resolves %s -> %s', (input, expected) => {
      expect(resolve(input).taxonomyName).toBe(expected);
    });
  });

  describe('side disambiguation', () => {
    it.each([
      ['left headlight', 'Headlight (Left)'],
      ['right headlight', 'Headlight (Right)'],
      ['headlamp left', 'Headlight (Left)'],
      ['left head lamp', 'Headlight (Left)'],
      ['front bumper', 'Bumper (Front)'],
      ['rear bumper', 'Bumper (Rear)'],
      ['back bumper', 'Bumper (Rear)'],
      ['left fender', 'Fender (Left)'],
      ['right wing', 'Fender (Right)'],
      ['left tail light', 'Taillight (Left)'],
      ['right rear light', 'Taillight (Right)'],
      ['left side mirror', 'Mirror (Left)'],
    ])('resolves %s -> %s', (input, expected) => {
      expect(resolve(input).taxonomyName).toBe(expected);
    });

    it('maps driver -> left and passenger -> right across naming conventions', () => {
      // The taxonomy says Fender (Left) but a worker/model may say "driver
      // fender"; without the alias these never meet.
      expect(resolve('driver fender').taxonomyName).toBe('Fender (Left)');
      expect(resolve('passenger fender').taxonomyName).toBe('Fender (Right)');
      // ...and the reverse: taxonomy says Door (Driver Front), model says left.
      expect(resolve('left front door').taxonomyName).toBe(
        'Door (Driver Front)',
      );
      expect(resolve('driver front door').taxonomyName).toBe(
        'Door (Driver Front)',
      );
      expect(resolve('passenger front door').taxonomyName).toBe(
        'Door (Passenger Front)',
      );
    });
  });

  describe('ambiguity is surfaced, not guessed', () => {
    it('returns both candidates when a sided part has no side given', () => {
      const result = resolve('headlight');
      expect(result.taxonomyId).toBeNull();
      expect(result.candidateIds).toHaveLength(2);
      expect(result.candidateIds).toEqual(
        expect.arrayContaining([
          byName('Headlight (Left)'),
          byName('Headlight (Right)'),
        ]),
      );
    });

    it('narrows but still asks when side info is partial', () => {
      // "front door" rules out nothing here (both doors are front), so the
      // worker still picks -- but it must not silently choose driver.
      const result = resolve('front door');
      expect(result.taxonomyId).toBeNull();
      expect(result.candidateIds).toEqual(
        expect.arrayContaining([
          byName('Door (Driver Front)'),
          byName('Door (Passenger Front)'),
        ]),
      );
    });

    it('does not treat a bare fender as either side', () => {
      expect(resolve('fender').taxonomyId).toBeNull();
      expect(resolve('fender').candidateIds).toHaveLength(2);
    });

    it('reports a part whose side contradicts every candidate as unmapped', () => {
      // Regression: found in the first live run against real walkaround
      // photos. A detection whose side info agrees with NO row must come
      // back unmapped rather than being offered as a pick between rows that
      // merely share its name -- accepting either files the wrong part.
      //
      // This used to be demonstrated with "left rear door", because the
      // taxonomy had front doors only. Rear doors now exist (2026-08-08) and
      // that input resolves properly, so the behaviour is pinned here with
      // seats, which are Driver/Passenger only and have no front/rear
      // variants.
      for (const input of ['rear driver seat', 'rear passenger seat']) {
        const result = resolve(input);
        expect(result.taxonomyId).toBeNull();
        expect(result.candidateIds).toEqual([]);
      }
    });

    it('resolves rear doors now that the taxonomy has them', () => {
      // The counterpart to the test above: this is the input that used to
      // be unfileable. Every 4-door vehicle has two of these.
      expect(resolve('left rear door').taxonomyName).toBe('Door (Driver Rear)');
      expect(resolve('right rear door').taxonomyName).toBe(
        'Door (Passenger Rear)',
      );
      expect(resolve('passenger rear door').taxonomyName).toBe(
        'Door (Passenger Rear)',
      );
    });

    it('treats a side-only door as ambiguous now that rear doors exist', () => {
      // "left door" used to resolve outright, because Door (Driver Front)
      // was the only left-hand door in the taxonomy. With rear doors added
      // it genuinely IS ambiguous, and surfacing that beats silently
      // picking the front one.
      const left = resolve('left door');
      expect(left.taxonomyId).toBeNull();
      expect(left.candidateIds).toEqual(
        expect.arrayContaining([
          byName('Door (Driver Front)'),
          byName('Door (Driver Rear)'),
        ]),
      );
      expect(left.candidateIds).toHaveLength(2);

      // Front/rear plus a side still settles it.
      expect(resolve('left front door').taxonomyName).toBe(
        'Door (Driver Front)',
      );
    });
  });

  describe('exterior rows added 2026-08-08', () => {
    // Every one of these came back unmapped before those rows existed, and
    // so could not be filed at all despite the AI detecting them reliably.
    it.each([
      ['windshield', 'Windshield'],
      ['windscreen', 'Windshield'],
      ['front glass', 'Windshield'],
      ['rear window', 'Rear Window'],
      ['back glass', 'Rear Window'],
      ['grille', 'Grille'],
      ['grill', 'Grille'],
      ['sunroof', 'Sunroof'],
      ['moonroof', 'Sunroof'],
      ['tailgate', 'Liftgate/Tailgate'],
      ['liftgate', 'Liftgate/Tailgate'],
      ['left quarter panel', 'Quarter Panel (Left)'],
      ['right rear quarter', 'Quarter Panel (Right)'],
      ['driver rocker panel', 'Rocker Panel (Left)'],
      ['passenger sill panel', 'Rocker Panel (Right)'],
    ])('resolves %s -> %s', (input, expected) => {
      expect(resolve(input).taxonomyName).toBe(expected);
    });

    it('leaves a bare quarter panel ambiguous rather than picking a side', () => {
      const result = resolve('quarter panel');
      expect(result.taxonomyId).toBeNull();
      expect(result.candidateIds).toHaveLength(2);
    });

    // "backlight" is real glass-trade usage for the rear window, but in
    // casual usage it just as often means a taillight. Mapping it would
    // risk filing a lamp as glass, so it stays unmapped on purpose.
    it('leaves "back light" unmapped rather than guessing glass vs lamp', () => {
      expect(resolve('back light').taxonomyId).toBeNull();
    });
  });

  describe('unmapped detections', () => {
    it.each(['catalytic converter', 'fuel pump', 'dashboard'])(
      'reports %s as unmapped rather than forcing a match',
      (input) => {
        const result = resolve(input);
        expect(result.taxonomyId).toBeNull();
        expect(result.candidateIds).toEqual([]);
      },
    );

    it('never throws on junk input', () => {
      for (const junk of ['', '   ', '???', '123']) {
        expect(() => resolve(junk)).not.toThrow();
        expect(resolve(junk).taxonomyId).toBeNull();
      }
    });
  });

  describe('resolveAll', () => {
    it('deduplicates repeated names across a batch', () => {
      const result = matcher.resolveAll(
        ['hood', 'hood', 'left headlight'],
        taxonomies,
      );
      expect(result.size).toBe(2);
      expect(result.get('hood')!.taxonomyName).toBe('Hood');
    });

    it('returns an entry for every distinct input, mapped or not', () => {
      const names = ['hood', 'catalytic converter', 'headlight'];
      const result = matcher.resolveAll(names, taxonomies);
      expect([...result.keys()].sort()).toEqual([...names].sort());
    });
  });
});
