import type { DraftPhoto, PartDetectionResult, PartDraft } from "./types";

/** One detection the worker ticked, paired with the photo it came from. */
export interface AcceptedDetection {
  taxonomyId: string;
  taxonomyName: string;
  photo: DraftPhoto;
  grade: "A" | "B" | "C";
  damageCodes: string[];
  confidence: number;
}

export interface DetectionMergePlan {
  /** Parts that don't exist in the draft yet, each with its source photos. */
  newParts: PartDraft[];
  /** Photos to append to parts the draft already has. */
  photosForExistingParts: Array<{
    partId: string;
    photo: DraftPhoto;
    detection: PartDetectionResult;
  }>;
}

/**
 * Turns a flat list of accepted detections into the minimum set of draft
 * mutations, deduplicating along two axes that both produce real damage if
 * ignored:
 *
 * 1. The same part across photos. A walkaround shows the hood from the
 *    front AND the side, so "hood" comes back on two images. Creating a
 *    Part per detection would put two Hood rows in one vehicle's inventory.
 *    They collapse to one Part holding both photos -- which is strictly
 *    better evidence for the grader than either photo alone.
 * 2. The same part twice in one photo. Models occasionally list a part
 *    twice in a single response; the same photo must not be attached to the
 *    same part twice.
 *
 * It also respects parts the worker already added by hand through the
 * part-first flow: those get the new photos appended rather than a
 * duplicate Part created, which is what keeps the two flows usable together
 * on one vehicle.
 */
export function planDetectionMerge(
  accepted: AcceptedDetection[],
  existingParts: PartDraft[],
  newPartId: () => string = () => crypto.randomUUID(),
): DetectionMergePlan {
  const byTaxonomy = new Map<string, AcceptedDetection[]>();
  for (const detection of accepted) {
    const group = byTaxonomy.get(detection.taxonomyId);
    if (group) {
      group.push(detection);
    } else {
      byTaxonomy.set(detection.taxonomyId, [detection]);
    }
  }

  const plan: DetectionMergePlan = { newParts: [], photosForExistingParts: [] };

  for (const [taxonomyId, group] of byTaxonomy) {
    const distinctPhotos: DraftPhoto[] = [];
    const detections: PartDetectionResult[] = [];
    const seenPhotoIds = new Set<string>();
    for (const item of group) {
      if (seenPhotoIds.has(item.photo.id)) continue;
      seenPhotoIds.add(item.photo.id);
      distinctPhotos.push(item.photo);
      detections.push({
        photoId: item.photo.id,
        grade: item.grade,
        damageCodes: item.damageCodes,
        confidence: item.confidence,
      });
    }

    const existing = existingParts.find((p) => p.taxonomyId === taxonomyId);
    if (existing) {
      const alreadyOnPart = new Set(existing.photos.map((p) => p.id));
      distinctPhotos.forEach((photo, i) => {
        if (!alreadyOnPart.has(photo.id)) {
          plan.photosForExistingParts.push({
            partId: existing.id,
            photo,
            detection: detections[i],
          });
        }
      });
      continue;
    }

    plan.newParts.push({
      id: newPartId(),
      taxonomyId,
      taxonomyName: group[0].taxonomyName,
      photos: distinctPhotos,
      detections,
    });
  }

  return plan;
}
