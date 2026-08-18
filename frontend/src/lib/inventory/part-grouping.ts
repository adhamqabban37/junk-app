/**
 * Derives Inventory's display grouping from stored taxonomy names.
 *
 * Position exists nowhere else. `PartTaxonomy` carries only
 * name/category/isQuickPick, and `category` is far too coarse to group on
 * -- "Body" alone holds doors, fenders, bumpers, quarter panels, rocker
 * panels, grille, hood, trunk, liftgate and mirrors. Grouping on it would
 * produce one enormous section, which is the opposite of what was asked
 * for.
 *
 * So the family and position are parsed back out of the name string:
 * "Door (Driver Front)" -> Doors / Front Left.
 *
 * This is a DISPLAY layer. Stored names, TaxonomyMatcher's SIDE_ALIASES and
 * the Car-Part export boundary are deliberately untouched -- canonical
 * inventory is never reshaped for a view (CLAUDE.md rule 6b), and the
 * export adapter has its own vocabulary to answer to.
 */

/**
 * Trailing-parenthetical qualifiers that genuinely denote a position,
 * mapped to what the manager UI shows.
 *
 * Driver -> Left and Passenger -> Right is a LEFT-HAND-DRIVE assumption.
 * It is false in RHD markets and will need to become a tenant setting if
 * the product ever ships to one. Stated here rather than buried so the
 * assumption is findable when that day comes.
 *
 * Anything not in this table is treated as a non-positional qualifier --
 * "Engine (Complete)" must not become a phantom "Engines" section.
 */
const POSITIONS: Record<string, string> = {
  "driver front": "Front Left",
  "passenger front": "Front Right",
  "driver rear": "Rear Left",
  "passenger rear": "Rear Right",
  driver: "Left",
  passenger: "Right",
  left: "Left",
  right: "Right",
  front: "Front",
  rear: "Rear",
};

/**
 * Physical reading order, so a family's positions never shuffle between
 * renders. Front-to-back then left-to-right, with the single-axis
 * positions after the two-axis ones.
 */
const POSITION_ORDER = [
  "Front Left",
  "Front Right",
  "Rear Left",
  "Rear Right",
  "Front",
  "Rear",
  "Left",
  "Right",
];

/** Fallback family for a part whose taxonomy row is missing or unnamed. */
const UNNAMED_FAMILY = "Part";

export interface ParsedPartName {
  /** Section heading: pluralized when the part is one of a positioned set. */
  family: string;
  /** Display position, or null for a part that has no positioned variants. */
  position: string | null;
}

export interface PartGroupEntry<T> {
  item: T;
  position: string | null;
}

export interface PartGroup<T> {
  family: string;
  /**
   * Whether to render a heading. False for a family holding a single part
   * -- "parts that are in multiples" taken literally, so an inventory of
   * singletons does not become a wall of one-item headings.
   */
  isSection: boolean;
  entries: PartGroupEntry<T>[];
}

function pluralize(family: string): string {
  return family.endsWith("s") ? family : `${family}s`;
}

export function parsePartName(name: string): ParsedPartName {
  // Only a TRAILING parenthetical is a position. "Rear Window" leads with a
  // positional word but is a whole part name, not a positioned variant of
  // some "Window" family.
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
  if (!match) {
    return { family: name, position: null };
  }

  const [, base, qualifier] = match;
  const position = POSITIONS[qualifier.trim().toLowerCase()];
  if (!position || base.length === 0) {
    // A qualifier we don't recognize stays part of the name rather than
    // being dropped or guessed at.
    return { family: name, position: null };
  }

  return { family: pluralize(base), position };
}

function positionRank(position: string | null): number {
  if (position === null) return POSITION_ORDER.length;
  const index = POSITION_ORDER.indexOf(position);
  return index === -1 ? POSITION_ORDER.length : index;
}

export function groupPartsByFamily<T>(
  items: T[],
  getName: (item: T) => string | null,
): PartGroup<T>[] {
  const byFamily = new Map<string, PartGroupEntry<T>[]>();

  for (const item of items) {
    const name = getName(item);
    const { family, position } =
      name === null || name.length === 0
        ? { family: UNNAMED_FAMILY, position: null }
        : parsePartName(name);

    const entries = byFamily.get(family) ?? [];
    entries.push({ item, position });
    byFamily.set(family, entries);
  }

  const groups: PartGroup<T>[] = Array.from(byFamily, ([family, entries]) => ({
    family,
    isSection: entries.length > 1,
    // Stable within an equal rank, so two parts sharing a position (two
    // vehicles' front left doors) keep their incoming order.
    entries: entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          positionRank(a.entry.position) - positionRank(b.entry.position) ||
          a.index - b.index,
      )
      .map(({ entry }) => entry),
  }));

  // Sections first: the grouped families are the point of the view, and
  // burying them among singletons would defeat it.
  return groups.sort(
    (a, b) =>
      Number(b.isSection) - Number(a.isSection) ||
      a.family.localeCompare(b.family),
  );
}
