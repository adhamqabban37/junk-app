import { describe, expect, it } from "vitest";
import { groupPartsByFamily, parsePartName } from "./part-grouping";

/**
 * Every name in backend/src/database/seeds/taxonomy.seed.ts as of
 * 2026-08-15. The parser derives display grouping from these strings
 * because position exists nowhere else -- PartTaxonomy has only
 * name/category/isQuickPick -- so a name this misreads is a part that
 * lands in the wrong section of Inventory.
 */
const SEEDED_NAMES = [
  "Alternator",
  "Starter Motor",
  "Engine (Complete)",
  "Transmission",
  "Radiator",
  "Bumper (Front)",
  "Bumper (Rear)",
  "Door (Driver Front)",
  "Door (Passenger Front)",
  "Hood",
  "Trunk Lid",
  "Fender (Left)",
  "Fender (Right)",
  "Headlight (Left)",
  "Headlight (Right)",
  "Taillight (Left)",
  "Taillight (Right)",
  "Mirror (Left)",
  "Mirror (Right)",
  "Wheel/Rim",
  "Seat (Driver)",
  "Seat (Passenger)",
  "Door (Driver Rear)",
  "Door (Passenger Rear)",
  "Quarter Panel (Left)",
  "Quarter Panel (Right)",
  "Rocker Panel (Left)",
  "Rocker Panel (Right)",
  "Grille",
  "Liftgate/Tailgate",
  "Windshield",
  "Rear Window",
  "Sunroof",
];

describe("parsePartName", () => {
  it("maps driver/passenger doors to front/rear + left/right", () => {
    // The stored taxonomy says Driver/Passenger; the manager UI was asked
    // for Front/Rear + Left/Right. Translation happens here and nowhere
    // else -- storage, TaxonomyMatcher and the export boundary are
    // deliberately untouched.
    expect(parsePartName("Door (Driver Front)")).toEqual({
      family: "Doors",
      position: "Front Left",
    });
    expect(parsePartName("Door (Passenger Front)")).toEqual({
      family: "Doors",
      position: "Front Right",
    });
    expect(parsePartName("Door (Driver Rear)")).toEqual({
      family: "Doors",
      position: "Rear Left",
    });
    expect(parsePartName("Door (Passenger Rear)")).toEqual({
      family: "Doors",
      position: "Rear Right",
    });
  });

  it("keeps plain left/right panels and lighting on their own axis", () => {
    expect(parsePartName("Fender (Left)")).toEqual({
      family: "Fenders",
      position: "Left",
    });
    expect(parsePartName("Headlight (Right)")).toEqual({
      family: "Headlights",
      position: "Right",
    });
    expect(parsePartName("Quarter Panel (Left)")).toEqual({
      family: "Quarter Panels",
      position: "Left",
    });
  });

  it("handles front/rear as a position without inventing a side", () => {
    expect(parsePartName("Bumper (Front)")).toEqual({
      family: "Bumpers",
      position: "Front",
    });
    expect(parsePartName("Bumper (Rear)")).toEqual({
      family: "Bumpers",
      position: "Rear",
    });
  });

  it("maps a bare driver/passenger qualifier to a side", () => {
    expect(parsePartName("Seat (Driver)")).toEqual({
      family: "Seats",
      position: "Left",
    });
    expect(parsePartName("Seat (Passenger)")).toEqual({
      family: "Seats",
      position: "Right",
    });
  });

  /**
   * "(Complete)" is a qualifier, not a position. Treating every
   * parenthetical as a position would file Engine (Complete) under a
   * phantom "Engines" section with one member.
   */
  it("does not treat a non-positional parenthetical as a position", () => {
    expect(parsePartName("Engine (Complete)")).toEqual({
      family: "Engine (Complete)",
      position: null,
    });
  });

  it("leaves parts with no position alone, unpluralized", () => {
    expect(parsePartName("Alternator")).toEqual({
      family: "Alternator",
      position: null,
    });
    expect(parsePartName("Hood")).toEqual({ family: "Hood", position: null });
    expect(parsePartName("Wheel/Rim")).toEqual({
      family: "Wheel/Rim",
      position: null,
    });
    expect(parsePartName("Liftgate/Tailgate")).toEqual({
      family: "Liftgate/Tailgate",
      position: null,
    });
  });

  /**
   * "Rear Window" starts with a positional word but is a whole part name,
   * not a positioned variant of a "Window" family. Only a trailing
   * parenthetical counts as a position.
   */
  it("does not mistake a leading positional word for a position", () => {
    expect(parsePartName("Rear Window")).toEqual({
      family: "Rear Window",
      position: null,
    });
  });

  it("degrades unparseable names to a flat entry rather than dropping them", () => {
    // The project's standing rule for ambiguity: surface it, never guess,
    // never silently discard.
    expect(parsePartName("Whatsit (Nonsense Qualifier)")).toEqual({
      family: "Whatsit (Nonsense Qualifier)",
      position: null,
    });
    expect(parsePartName("")).toEqual({ family: "", position: null });
  });

  it("never throws and always returns a family for every seeded name", () => {
    for (const name of SEEDED_NAMES) {
      const parsed = parsePartName(name);
      expect(parsed.family.length).toBeGreaterThan(0);
    }
  });
});

describe("groupPartsByFamily", () => {
  const part = (id: string, taxonomyName: string | null) => ({ id, taxonomyName });

  it("collects a family's positions into one section, in physical order", () => {
    const groups = groupPartsByFamily(
      [
        part("1", "Door (Passenger Rear)"),
        part("2", "Door (Driver Front)"),
        part("3", "Door (Passenger Front)"),
        part("4", "Door (Driver Rear)"),
      ],
      (p) => p.taxonomyName,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].family).toBe("Doors");
    expect(groups[0].isSection).toBe(true);
    expect(groups[0].entries.map((e) => e.position)).toEqual([
      "Front Left",
      "Front Right",
      "Rear Left",
      "Rear Right",
    ]);
  });

  /**
   * "Parts that are in multiples" taken literally: a family holding one
   * part is not a section and must not get a header, or an inventory of
   * singletons becomes a wall of one-item headings.
   */
  it("does not make a section out of a family with a single part", () => {
    const groups = groupPartsByFamily(
      [part("1", "Alternator"), part("2", "Door (Driver Front)")],
      (p) => p.taxonomyName,
    );

    const alternator = groups.find((g) => g.family === "Alternator");
    expect(alternator?.isSection).toBe(false);
    expect(alternator?.entries).toHaveLength(1);
  });

  it("treats duplicates of one position as a real section", () => {
    // Inventory spans vehicles, so two Front Left Doors from two cars is
    // normal and should still group under Doors.
    const groups = groupPartsByFamily(
      [part("1", "Door (Driver Front)"), part("2", "Door (Driver Front)")],
      (p) => p.taxonomyName,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].isSection).toBe(true);
    expect(groups[0].entries).toHaveLength(2);
  });

  it("sorts sections before singletons, each alphabetically", () => {
    const groups = groupPartsByFamily(
      [
        part("1", "Radiator"),
        part("2", "Fender (Left)"),
        part("3", "Fender (Right)"),
        part("4", "Alternator"),
      ],
      (p) => p.taxonomyName,
    );

    expect(groups.map((g) => g.family)).toEqual([
      "Fenders",
      "Alternator",
      "Radiator",
    ]);
  });

  it("keeps parts with a null taxonomy name instead of dropping them", () => {
    const groups = groupPartsByFamily([part("1", null)], (p) => p.taxonomyName);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].family).toBe("Part");
  });

  it("preserves every input part exactly once", () => {
    const parts = SEEDED_NAMES.map((n, i) => part(String(i), n));
    const groups = groupPartsByFamily(parts, (p) => p.taxonomyName);

    const seen = groups.flatMap((g) => g.entries.map((e) => e.item.id));
    expect(seen).toHaveLength(parts.length);
    expect(new Set(seen).size).toBe(parts.length);
  });
});
