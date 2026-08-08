import { Injectable } from '@nestjs/common';
import { PartTaxonomy } from '../database/entities';

/**
 * Result of resolving one free-text Gemini part name against part_taxonomies.
 *
 * The three states are deliberately distinct, because the UI treats them
 * differently and collapsing them would silently put wrong parts into a
 * yard's inventory:
 *
 * - resolved   -> taxonomyId set, candidateIds has exactly that one id.
 * - ambiguous  -> taxonomyId null, candidateIds lists the plausible rows.
 *                 Happens when the model names a part whose taxonomy has
 *                 left/right variants but doesn't say which side. The worker
 *                 is standing at the vehicle; asking beats guessing.
 * - unmapped   -> taxonomyId null, candidateIds empty. The model saw
 *                 something this yard's taxonomy has no row for
 *                 (windshield, quarter panel). Still surfaced to the worker
 *                 with its grade, assignable by hand -- never dropped
 *                 silently, since a dropped detection is invisible.
 */
export interface TaxonomyResolution {
  taxonomyId: string | null;
  taxonomyName: string | null;
  candidateIds: string[];
}

/**
 * Left-hand-drive assumption: driver === left, passenger === right. The
 * taxonomy mixes both conventions in its own rows (Door (Driver Front) but
 * Fender (Left)), so without this a worker's "driver fender" would never
 * reach Fender (Left). Wrong for RHD markets; called out here rather than
 * buried, since making it configurable is a real change, not a tweak.
 */
const SIDE_ALIASES: Record<string, string> = {
  driver: 'left',
  passenger: 'right',
  back: 'rear',
};

const CANONICAL_SIDES = ['left', 'right', 'front', 'rear'];

/**
 * Side/position qualifiers that are modifiers, not part identity. Derived
 * from SIDE_ALIASES rather than listed separately: an alias missing from
 * this set is silently treated as part of the part's NAME, which is how
 * "back bumper" originally resolved to nothing at all instead of
 * Bumper (Rear).
 */
const SIDE_TOKENS = new Set([...CANONICAL_SIDES, ...Object.keys(SIDE_ALIASES)]);

/**
 * Phrase-level rewrites applied before tokenizing, longest first. These
 * collapse the many things a model calls one part down to the wording the
 * taxonomy actually uses.
 */
const PHRASE_SYNONYMS: Array<[RegExp, string]> = [
  [/\btail\s*lamps?\b/g, 'taillight'],
  [/\btail\s*lights?\b/g, 'taillight'],
  [/\brear\s*lights?\b/g, 'taillight'],
  [/\bhead\s*lamps?\b/g, 'headlight'],
  [/\bhead\s*lights?\b/g, 'headlight'],
  [/\bwing\s*mirrors?\b/g, 'mirror'],
  [/\bside\s*mirrors?\b/g, 'mirror'],
  [/\bdoor\s*mirrors?\b/g, 'mirror'],
  [/\brear\s*view\s*mirrors?\b/g, 'mirror'],
  [/\bbumper\s*covers?\b/g, 'bumper'],
  [/\bbumper\s*fascias?\b/g, 'bumper'],
  [/\btrunk\s*lids?\b/g, 'trunk'],
  [/\bboot\s*lids?\b/g, 'trunk'],
  // Glass. "backlight" is genuine industry usage for the rear window and
  // would otherwise collide with the lighting rows via the "light" token.
  [/\bwind\s*screens?\b/g, 'windshield'],
  [/\bwind\s*shields?\b/g, 'windshield'],
  [/\bfront\s*glass\b/g, 'windshield'],
  [/\brear\s*wind\s*screens?\b/g, 'rear window'],
  [/\brear\s*glass\b/g, 'rear window'],
  [/\bback\s*glass\b/g, 'rear window'],
  // Deliberately NOT mapping "backlight"/"back light" -> rear window, even
  // though that is genuine glass-trade usage. In casual usage it just as
  // often means a taillight, and filing a taillight as glass is precisely
  // the wrong-part-number outcome this matcher exists to prevent. Left
  // unmapped instead; the scan prompt is seeded with the taxonomy's own
  // wording, so the model says "rear window" anyway.
  [/\brear\s*windows?\b/g, 'rear window'],
  [/\bmoon\s*roofs?\b/g, 'sunroof'],
  [/\bsun\s*roofs?\b/g, 'sunroof'],
  // Body panels.
  [/\bquarter\s*panels?\b/g, 'quarter'],
  [/\brear\s*quarters?\b/g, 'quarter'],
  [/\brocker\s*panels?\b/g, 'rocker'],
  [/\bsill\s*panels?\b/g, 'rocker'],
  [/\btail\s*gates?\b/g, 'liftgate'],
  [/\blift\s*gates?\b/g, 'liftgate'],
  [/\bhatch\s*backs?\b/g, 'liftgate'],
  [/\brear\s*hatch(es)?\b/g, 'liftgate'],
  [/\bgrilles?\b/g, 'grille'],
  [/\bgrills?\b/g, 'grille'],
  [/\bstarter\s*motors?\b/g, 'starter'],
  [/\bengine\s*blocks?\b/g, 'engine'],
  [/\bcomplete\s*engines?\b/g, 'engine'],
  [/\balloy\s*wheels?\b/g, 'wheel'],
  [/\bsteel\s*wheels?\b/g, 'wheel'],
];

/** Single-token synonyms, applied after tokenizing. */
const TOKEN_SYNONYMS: Record<string, string> = {
  bonnet: 'hood',
  boot: 'trunk',
  wing: 'fender',
  gearbox: 'transmission',
  transaxle: 'transmission',
  rad: 'radiator',
  motor: 'engine',
  starter: 'starter',
  rim: 'wheel',
  rims: 'wheel',
  wheels: 'wheel',
  tyre: 'wheel',
  tire: 'wheel',
  doors: 'door',
  seats: 'seat',
  mirrors: 'mirror',
  fenders: 'fender',
  bumpers: 'bumper',
  headlights: 'headlight',
  taillights: 'taillight',
  alternators: 'alternator',
  radiators: 'radiator',
};

/** Noise words that carry no identity and no side. */
const STOP_TOKENS = new Set(['the', 'a', 'an', 'of', 'assembly', 'complete']);

interface IndexedTaxonomy {
  id: string;
  name: string;
  /** Identity tokens, e.g. Bumper (Front) -> ["bumper"]. */
  base: string[];
  /** Side tokens, normalized through SIDE_ALIASES. */
  sides: Set<string>;
}

@Injectable()
export class TaxonomyMatcher {
  /**
   * Resolves every detection name against the supplied taxonomy rows.
   * Pure and synchronous -- callers load the taxonomy once (23 rows today)
   * and reuse it across a whole batch rather than hitting the DB per photo.
   */
  resolveAll(
    names: string[],
    taxonomies: PartTaxonomy[],
  ): Map<string, TaxonomyResolution> {
    const index = taxonomies.map((t) => this.indexRow(t));
    const out = new Map<string, TaxonomyResolution>();
    for (const name of names) {
      if (!out.has(name)) {
        out.set(name, this.resolve(name, index));
      }
    }
    return out;
  }

  private indexRow(row: PartTaxonomy): IndexedTaxonomy {
    // "Wheel/Rim" -> the slash is an alternation, not two separate words;
    // normalizeTokens maps "rim" onto "wheel" so both collapse to one base.
    const tokens = this.normalizeTokens(row.name);
    const sides = new Set<string>();
    const base: string[] = [];
    for (const token of tokens) {
      if (SIDE_TOKENS.has(token)) {
        sides.add(SIDE_ALIASES[token] ?? token);
      } else {
        base.push(token);
      }
    }
    return { id: row.id, name: row.name, base, sides };
  }

  private resolve(
    rawName: string,
    index: IndexedTaxonomy[],
  ): TaxonomyResolution {
    const tokens = this.normalizeTokens(rawName);
    const sides = new Set<string>();
    const base: string[] = [];
    for (const token of tokens) {
      if (SIDE_TOKENS.has(token)) {
        sides.add(SIDE_ALIASES[token] ?? token);
      } else {
        base.push(token);
      }
    }

    if (base.length === 0) {
      return { taxonomyId: null, taxonomyName: null, candidateIds: [] };
    }

    // Identity first: a detection can only ever match rows describing the
    // same part. Side is a tiebreak among those, never a way in.
    const sameBase = index.filter((row) => this.baseMatches(base, row.base));
    if (sameBase.length === 0) {
      return { taxonomyId: null, taxonomyName: null, candidateIds: [] };
    }
    if (sameBase.length === 1) {
      return {
        taxonomyId: sameBase[0].id,
        taxonomyName: sameBase[0].name,
        candidateIds: [sameBase[0].id],
      };
    }

    // Several rows share this identity (Headlight (Left)/(Right)), so the
    // detection's side tokens have to separate them.
    const exact = sameBase.filter((row) => this.sidesEqual(sides, row.sides));
    if (exact.length === 1) {
      return {
        taxonomyId: exact[0].id,
        taxonomyName: exact[0].name,
        candidateIds: [exact[0].id],
      };
    }

    // Partial side info: "front door" against Door (Driver Front) /
    // Door (Passenger Front) narrows the field but doesn't settle it.
    if (sides.size === 0) {
      return {
        taxonomyId: null,
        taxonomyName: null,
        candidateIds: sameBase.map((c) => c.id),
      };
    }

    const candidates = sameBase.filter((row) =>
      this.isSubset(sides, row.sides),
    );

    // Side info that contradicts every candidate means the taxonomy has no
    // row for what was actually seen -- unmapped, NOT a pick between the
    // rows that happen to share its name. Real case that forced this: the
    // seeded taxonomy has only front doors, so "left rear door" was being
    // offered as a choice between Door (Driver Front) and
    // Door (Passenger Front), inviting a worker to file a rear door as a
    // front one. A wrong part number is worse than an unresolved one.
    if (candidates.length === 0) {
      return { taxonomyId: null, taxonomyName: null, candidateIds: [] };
    }

    if (candidates.length === 1) {
      return {
        taxonomyId: candidates[0].id,
        taxonomyName: candidates[0].name,
        candidateIds: [candidates[0].id],
      };
    }
    return {
      taxonomyId: null,
      taxonomyName: null,
      candidateIds: candidates.map((c) => c.id),
    };
  }

  /**
   * Base tokens match when either side's token list is contained in the
   * other. Containment rather than equality so "door" reaches
   * Door (Driver Front) (whose own base is just ["door"]) and so a wordier
   * detection like "radiator support" still reaches Radiator.
   */
  private baseMatches(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return false;
    const setA = new Set(a);
    const setB = new Set(b);
    const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
    for (const token of small) {
      if (!large.has(token)) return false;
    }
    return true;
  }

  private sidesEqual(a: Set<string>, b: Set<string>): boolean {
    return a.size === b.size && this.isSubset(a, b);
  }

  private isSubset(a: Set<string>, b: Set<string>): boolean {
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  private normalizeTokens(value: string): string[] {
    let text = value.toLowerCase();
    for (const [pattern, replacement] of PHRASE_SYNONYMS) {
      text = text.replace(pattern, replacement);
    }
    return text
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((token) => token.length > 0 && !STOP_TOKENS.has(token))
      .map((token) => TOKEN_SYNONYMS[token] ?? token);
  }
}
