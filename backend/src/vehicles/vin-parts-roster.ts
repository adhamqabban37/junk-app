/**
 * Derives the exterior parts a vehicle *should* have from the NHTSA decode
 * already stored on `Vehicle.decodedRaw`.
 *
 * IMPORTANT, and worth repeating to anyone who reads the output: this is a
 * body-style heuristic, NOT fitment data. A VIN does not carry a parts
 * catalogue. NHTSA's free vPIC decode returns vehicle attributes; real
 * fitment is AutoCare/ACES or Hollander, both licensed and both explicitly
 * out of MVP scope (ARCHITECTURE.md §5). What this does is read the two
 * attributes that actually determine which exterior panels exist -- door
 * count and body class -- and expand them into taxonomy row names.
 *
 * That is enough to be genuinely useful ("a 4-door sedan has two rear doors
 * and a trunk lid, not a liftgate") without pretending to a precision we
 * don't have. Anything it cannot determine is left OUT of `expected` rather
 * than guessed, because a checklist that lists parts the vehicle never had
 * can never be completed.
 *
 * Every name returned here must exist in part_taxonomies (taxonomy.seed.ts)
 * or it can never be matched -- vin-parts-roster.spec.ts and the seed are
 * the contract.
 */
export interface VehicleRoster {
  /** Taxonomy row names this vehicle is expected to have. */
  expected: string[];
  doors: number | null;
  bodyClass: string | null;
  /** True when the decode was missing or incomplete, so `expected` is a floor, not a spec. */
  approximate: boolean;
}

/**
 * Present on every vehicle regardless of body style or door count. Sunroof
 * is deliberately absent: it is an option vPIC does not report, so claiming
 * it would leave the checklist permanently unfinishable.
 */
const ALWAYS: string[] = [
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
  'Wheel/Rim',
];

const FRONT_DOORS = ['Door (Driver Front)', 'Door (Passenger Front)'];
const REAR_DOORS = ['Door (Driver Rear)', 'Door (Passenger Rear)'];

/** Body classes whose rear closure is a liftgate/tailgate rather than a boot lid. */
const LIFTGATE_BODY_CLASSES = [
  'hatchback',
  'liftback',
  'wagon',
  'sport utility',
  'suv',
  'multi-purpose',
  'mpv',
  'van',
  'pickup',
  'truck',
  'crossover',
];

/** Body classes with a separate boot. */
const TRUNK_BODY_CLASSES = [
  'sedan',
  'saloon',
  'coupe',
  'convertible',
  'cabriolet',
  'roadster',
];

interface NhtsaRow {
  Variable?: unknown;
  Value?: unknown;
}

/**
 * Pulls one variable out of vPIC's flat Results array. Total by design --
 * `decodedRaw` is a jsonb column that may hold anything (a manually-entered
 * VIN never decoded, an older payload, a partial write), and a vehicle with
 * a junk decode must still be scannable.
 */
function readVariable(raw: unknown, variable: string): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const results = (raw as { Results?: unknown }).Results;
  if (!Array.isArray(results)) return null;

  for (const row of results as NhtsaRow[]) {
    if (
      typeof row === 'object' &&
      row !== null &&
      row.Variable === variable &&
      typeof row.Value === 'string'
    ) {
      const trimmed = row.Value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

export function deriveRoster(decodedRaw: unknown): VehicleRoster {
  const bodyClass = readVariable(decodedRaw, 'Body Class');
  const doorsRaw = readVariable(decodedRaw, 'Doors');
  const parsedDoors = doorsRaw === null ? NaN : Number.parseInt(doorsRaw, 10);
  const doors = Number.isNaN(parsedDoors) ? null : parsedDoors;

  const expected = [...ALWAYS, ...FRONT_DOORS];

  // Unknown door count keeps front doors only. Every vehicle has those;
  // rear doors are the claim that needs evidence.
  if (doors !== null && doors >= 4) {
    expected.push(...REAR_DOORS);
  }

  const normalizedBody = bodyClass?.toLowerCase() ?? '';
  if (LIFTGATE_BODY_CLASSES.some((term) => normalizedBody.includes(term))) {
    expected.push('Liftgate/Tailgate');
  } else if (TRUNK_BODY_CLASSES.some((term) => normalizedBody.includes(term))) {
    expected.push('Trunk Lid');
  }
  // else: body class unknown or unrecognised -- neither is added. Guessing
  // here would put a rear closure on the checklist that may not exist.

  return {
    // Deduped defensively: the lists above are disjoint today, but a future
    // body-class rule that also appends a panel must not be able to double
    // an entry and inflate the "expected parts" count the UI shows.
    expected: [...new Set(expected)],
    doors,
    bodyClass,
    approximate: bodyClass === null || doors === null,
  };
}
