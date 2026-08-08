import { describe, expect, it } from "vitest";
import { planDetectionMerge, type AcceptedDetection } from "./detections";
import type { DraftPhoto, PartDraft } from "./types";

const photo = (id: string): DraftPhoto => ({
  id,
  blob: new Blob(["x"], { type: "image/jpeg" }),
  qualityFlags: { blurry: false, tooDark: false },
  capturedAt: "2026-08-06T00:00:00.000Z",
});

const accepted = (
  taxonomyId: string,
  taxonomyName: string,
  photoId: string,
  grade: "A" | "B" | "C" = "A",
): AcceptedDetection => ({
  taxonomyId,
  taxonomyName,
  photo: photo(photoId),
  grade,
  damageCodes: [],
  confidence: 0.9,
});

// Deterministic ids so assertions don't depend on crypto.randomUUID.
const sequentialIds = () => {
  let n = 0;
  return () => `new-part-${n++}`;
};

describe("planDetectionMerge", () => {
  it("creates one part per distinct taxonomy", () => {
    const plan = planDetectionMerge(
      [accepted("tax-hood", "Hood", "p1"), accepted("tax-bumper", "Bumper (Front)", "p1")],
      [],
      sequentialIds(),
    );

    expect(plan.newParts).toHaveLength(2);
    expect(plan.newParts.map((p) => p.taxonomyName)).toEqual([
      "Hood",
      "Bumper (Front)",
    ]);
    expect(plan.photosForExistingParts).toEqual([]);
  });

  it("collapses the same part seen in several photos into one part with both", () => {
    // The real case: a walkaround catches the hood from the front and the
    // side. Two Hood rows on one vehicle would be a data-entry bug.
    const plan = planDetectionMerge(
      [accepted("tax-hood", "Hood", "p1"), accepted("tax-hood", "Hood", "p2")],
      [],
      sequentialIds(),
    );

    expect(plan.newParts).toHaveLength(1);
    expect(plan.newParts[0].photos.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("does not attach the same photo to a part twice", () => {
    const plan = planDetectionMerge(
      [accepted("tax-hood", "Hood", "p1"), accepted("tax-hood", "Hood", "p1")],
      [],
      sequentialIds(),
    );

    expect(plan.newParts).toHaveLength(1);
    expect(plan.newParts[0].photos).toHaveLength(1);
  });

  it("appends to a part the worker already added by hand", () => {
    const existing: PartDraft[] = [
      { id: "existing-1", taxonomyId: "tax-hood", taxonomyName: "Hood", photos: [] },
    ];

    const plan = planDetectionMerge(
      [accepted("tax-hood", "Hood", "p1")],
      existing,
      sequentialIds(),
    );

    expect(plan.newParts).toEqual([]);
    expect(plan.photosForExistingParts).toEqual([
      {
        partId: "existing-1",
        photo: expect.objectContaining({ id: "p1" }),
        detection: expect.objectContaining({ photoId: "p1", grade: "A" }),
      },
    ]);
  });

  it("carries each photo's own grade, not one grade for the part", () => {
    // Two photos of the same bumper can legitimately disagree (one angle
    // shows the crack). Collapsing them to a single grade here would throw
    // away the per-photo evidence the reviewer needs.
    const plan = planDetectionMerge(
      [
        accepted("tax-bumper", "Bumper (Front)", "p1", "A"),
        accepted("tax-bumper", "Bumper (Front)", "p2", "C"),
      ],
      [],
      sequentialIds(),
    );

    expect(plan.newParts[0].detections).toEqual([
      expect.objectContaining({ photoId: "p1", grade: "A" }),
      expect.objectContaining({ photoId: "p2", grade: "C" }),
    ]);
  });

  it("skips a photo the existing part already has", () => {
    const existing: PartDraft[] = [
      {
        id: "existing-1",
        taxonomyId: "tax-hood",
        taxonomyName: "Hood",
        photos: [photo("p1")],
      },
    ];

    const plan = planDetectionMerge(
      [accepted("tax-hood", "Hood", "p1"), accepted("tax-hood", "Hood", "p2")],
      existing,
      sequentialIds(),
    );

    expect(plan.photosForExistingParts).toEqual([
      {
        partId: "existing-1",
        photo: expect.objectContaining({ id: "p2" }),
        // The surviving photo must keep ITS OWN grade -- an off-by-one here
        // would file p2's photo under p1's grade.
        detection: expect.objectContaining({ photoId: "p2" }),
      },
    ]);
  });

  it("mixes new and existing parts in one pass", () => {
    const existing: PartDraft[] = [
      { id: "existing-1", taxonomyId: "tax-hood", taxonomyName: "Hood", photos: [] },
    ];

    const plan = planDetectionMerge(
      [
        accepted("tax-hood", "Hood", "p1"),
        accepted("tax-bumper", "Bumper (Front)", "p1"),
      ],
      existing,
      sequentialIds(),
    );

    expect(plan.newParts).toHaveLength(1);
    expect(plan.newParts[0].taxonomyId).toBe("tax-bumper");
    expect(plan.photosForExistingParts).toHaveLength(1);
  });

  it("returns an empty plan for no accepted detections", () => {
    expect(planDetectionMerge([], [], sequentialIds())).toEqual({
      newParts: [],
      photosForExistingParts: [],
    });
  });
});
