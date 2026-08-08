import { deriveRoster } from './vin-parts-roster';

/** Shapes a decodedRaw payload the way NHTSA vPIC actually returns it. */
function decoded(vars: Record<string, string>): unknown {
  return {
    Results: Object.entries(vars).map(([Variable, Value]) => ({
      Variable,
      Value,
    })),
  };
}

describe('deriveRoster', () => {
  describe('door count drives the door rows', () => {
    it('gives a 4-door both front and rear doors', () => {
      const roster = deriveRoster(
        decoded({ Doors: '4', 'Body Class': 'Sedan/Saloon' }),
      );
      expect(roster.doors).toBe(4);
      expect(roster.expected).toEqual(
        expect.arrayContaining([
          'Door (Driver Front)',
          'Door (Passenger Front)',
          'Door (Driver Rear)',
          'Door (Passenger Rear)',
        ]),
      );
    });

    it('gives a 2-door front doors only', () => {
      const roster = deriveRoster(
        decoded({ Doors: '2', 'Body Class': 'Coupe' }),
      );
      expect(roster.expected).toEqual(
        expect.arrayContaining([
          'Door (Driver Front)',
          'Door (Passenger Front)',
        ]),
      );
      // The whole point: a coupe must not be told it is missing two rear
      // doors it never had.
      expect(roster.expected).not.toContain('Door (Driver Rear)');
      expect(roster.expected).not.toContain('Door (Passenger Rear)');
    });
  });

  describe('body class drives the rear closure', () => {
    it.each([
      ['Sedan/Saloon', 'Trunk Lid'],
      ['Coupe', 'Trunk Lid'],
      ['Convertible/Cabriolet', 'Trunk Lid'],
    ])('%s gets a trunk lid', (bodyClass, expected) => {
      expect(
        deriveRoster(decoded({ 'Body Class': bodyClass })).expected,
      ).toContain(expected);
    });

    it.each([
      'Hatchback/Liftback/Notchback',
      'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)',
      'Wagon',
      'Van',
      'Pickup',
    ])('%s gets a liftgate/tailgate instead of a trunk', (bodyClass) => {
      const roster = deriveRoster(decoded({ 'Body Class': bodyClass }));
      expect(roster.expected).toContain('Liftgate/Tailgate');
      expect(roster.expected).not.toContain('Trunk Lid');
    });
  });

  it('always includes the exterior panels, glass and lighting, both sides', () => {
    const roster = deriveRoster(
      decoded({ Doors: '4', 'Body Class': 'Sedan/Saloon' }),
    );
    expect(roster.expected).toEqual(
      expect.arrayContaining([
        'Hood',
        'Bumper (Front)',
        'Bumper (Rear)',
        'Grille',
        'Windshield',
        'Rear Window',
        'Fender (Left)',
        'Fender (Right)',
        'Headlight (Left)',
        'Headlight (Right)',
        'Taillight (Left)',
        'Taillight (Right)',
        'Mirror (Left)',
        'Mirror (Right)',
        'Quarter Panel (Left)',
        'Quarter Panel (Right)',
        'Rocker Panel (Left)',
        'Rocker Panel (Right)',
      ]),
    );
  });

  // A sunroof is an option, not something vPIC reports. Claiming a vehicle
  // "should have" one would make the checklist permanently incomplete.
  it('does not claim a sunroof, which the VIN cannot tell us', () => {
    const roster = deriveRoster(
      decoded({ Doors: '4', 'Body Class': 'Sedan/Saloon' }),
    );
    expect(roster.expected).not.toContain('Sunroof');
  });

  describe('degrades instead of throwing', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'nonsense'],
      ['an empty object', {}],
      ['Results of the wrong type', { Results: 'nope' }],
      ['rows missing Value', { Results: [{ Variable: 'Doors' }] }],
    ])('handles %s', (_label, raw) => {
      expect(() => deriveRoster(raw)).not.toThrow();
      const roster = deriveRoster(raw);
      // Still useful: every vehicle has a hood and bumpers regardless.
      expect(roster.expected).toContain('Hood');
      expect(roster.approximate).toBe(true);
    });

    it('marks a decode with no body class as approximate and omits the rear closure', () => {
      const roster = deriveRoster(decoded({ Doors: '4' }));
      expect(roster.approximate).toBe(true);
      expect(roster.bodyClass).toBeNull();
      // We genuinely don't know whether it's a trunk or a liftgate, and
      // guessing would put a part on the checklist that doesn't exist.
      expect(roster.expected).not.toContain('Trunk Lid');
      expect(roster.expected).not.toContain('Liftgate/Tailgate');
    });

    it('is not approximate when both body class and doors decoded', () => {
      const roster = deriveRoster(
        decoded({ Doors: '4', 'Body Class': 'Sedan/Saloon' }),
      );
      expect(roster.approximate).toBe(false);
    });

    it('ignores a non-numeric door count', () => {
      const roster = deriveRoster(
        decoded({ Doors: 'not a number', 'Body Class': 'Sedan/Saloon' }),
      );
      expect(roster.doors).toBeNull();
      // Unknown door count still gets front doors -- every vehicle has them.
      expect(roster.expected).toContain('Door (Driver Front)');
      expect(roster.expected).not.toContain('Door (Driver Rear)');
    });
  });

  it('returns no duplicates', () => {
    const roster = deriveRoster(
      decoded({ Doors: '4', 'Body Class': 'Sedan/Saloon' }),
    );
    expect(new Set(roster.expected).size).toBe(roster.expected.length);
  });

  // The real payload stored on the user's own vehicle, confirmed live via
  // GET /vehicles/:id -- 140 NHTSA variables, of which these three matter.
  it('handles the real 2015 Hyundai Genesis decode', () => {
    const roster = deriveRoster(
      decoded({
        'Vehicle Type': 'PASSENGER CAR',
        'Body Class': 'Sedan/Saloon',
        Doors: '4',
        Make: 'HYUNDAI',
        Model: 'Genesis',
      }),
    );
    expect(roster.doors).toBe(4);
    expect(roster.bodyClass).toBe('Sedan/Saloon');
    expect(roster.approximate).toBe(false);
    expect(roster.expected).toContain('Trunk Lid');
    expect(roster.expected).toContain('Door (Passenger Rear)');
    expect(roster.expected.length).toBeGreaterThan(20);
  });
});
