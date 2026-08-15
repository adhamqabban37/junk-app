export type VinEntryMethod = "scanned" | "manual";

export type VehicleImageAngle = "front" | "rear" | "left" | "right";

export type DraftStatus = "draft" | "queued" | "syncing" | "synced" | "sync_failed";

export interface DecodedVehicle {
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  raw: Record<string, unknown>;
}

export interface QualityFlags {
  blurry: boolean;
  tooDark: boolean;
}

export interface DraftPhoto {
  id: string;
  blob: Blob;
  angle?: VehicleImageAngle;
  qualityFlags: QualityFlags;
  capturedAt: string;
}

/**
 * A grade the bulk scan already produced for one part in one photo.
 *
 * Carried through sync so the server can persist it instead of re-running
 * the single-part grading prompt on a scene photo. That re-grade would be
 * actively wrong: the prompt answers "grade THE part in this image", but a
 * walkaround photo holds a dozen parts, so every part sharing the photo
 * would be stamped with the same arbitrary grade -- overwriting per-part
 * grades the AI had already got right.
 */
export interface PartDetectionResult {
  /** The DraftPhoto this grade came from. */
  photoId: string;
  grade: "A" | "B" | "C" | "D";
  damageCodes: string[];
  confidence: number;
}

export interface PartDraft {
  id: string;
  taxonomyId: string;
  taxonomyName: string;
  photos: DraftPhoto[];
  /** Present only for parts added by the bulk scan flow. */
  detections?: PartDetectionResult[];
}

export interface TaxonomyItem {
  id: string;
  name: string;
  category: string;
  isQuickPick: boolean;
}

export interface VehicleDraft {
  id: string;
  vin: string | null;
  vinEntryMethod: VinEntryMethod | null;
  decoded: DecodedVehicle | null;
  exteriorPhotos: DraftPhoto[];
  parts: PartDraft[];
  status: DraftStatus;
  syncError?: string;
  createdAt: string;
  updatedAt: string;
}
