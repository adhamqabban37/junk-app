export type VinEntryMethod = "scanned" | "manual";

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
  qualityFlags: QualityFlags;
  capturedAt: string;
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
  photos: DraftPhoto[];
  status: DraftStatus;
  syncError?: string;
  createdAt: string;
  updatedAt: string;
}
