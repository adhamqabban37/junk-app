import { apiBaseUrl, authFetch } from "../api";

export type CrushStatus = "active" | "stripped" | "crushed";

export interface VehicleListItem {
  id: string;
  vin: string;
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  crushStatus: CrushStatus;
  createdAt: string;
  partsCount: number;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VehicleImage {
  id: string;
  angle: string;
  url: string;
}

export interface VehicleDetailPart {
  id: string;
  status: string;
  taxonomyId: string;
  taxonomyName: string | null;
  photosCount: number;
  createdAt: string;
}

export interface VehicleDetail extends VehicleListItem {
  images: VehicleImage[];
  parts: VehicleDetailPart[];
}

export function listVehicles(
  token: string,
  params: { crushStatus?: CrushStatus; page?: number; pageSize?: number } = {},
  fetchImpl?: typeof fetch,
): Promise<VehicleListResult> {
  const query = new URLSearchParams();
  if (params.crushStatus) query.set("crushStatus", params.crushStatus);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return authFetch<VehicleListResult>(`/vehicles${qs ? `?${qs}` : ""}`, { token }, fetchImpl);
}

export function getVehicle(token: string, id: string, fetchImpl?: typeof fetch): Promise<VehicleDetail> {
  return authFetch<VehicleDetail>(`/vehicles/${id}`, { token }, fetchImpl);
}

/** Attaches another exterior angle to an already-synced vehicle. */
export function addVehicleImage(
  token: string,
  vehicleId: string,
  angle: string,
  blob: Blob,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; angle: string; url: string }> {
  const formData = new FormData();
  formData.append("angle", angle);
  formData.append("file", blob, `${angle}.jpg`);
  return authFetch<{ id: string; angle: string; url: string }>(
    `/vehicles/${vehicleId}/images`,
    { token, method: "POST", body: formData },
    fetchImpl,
  );
}

/**
 * Auth is Bearer-token, not cookie, so <img src> can't hit the image
 * endpoint directly -- fetch with the header and hand back an object URL.
 * Callers own revoking it.
 */
export async function fetchVehicleImageObjectUrl(
  token: string,
  vehicleId: string,
  imageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${apiBaseUrl()}/vehicles/${vehicleId}/images/${imageId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load image (status ${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}

export interface ScannedPhotoSummary {
  index: number;
  clarity: "clear" | "partial" | "poor" | "unknown";
  note: string | null;
  detections: number;
  error?: string;
}

export interface UnresolvedDetection {
  partName: string;
  candidateIds: string[];
  reason: "ambiguous" | "unmapped";
  grade: string;
  confidence: number;
  photoIndex: number;
}

export interface VehicleScanSummary {
  vehicleId: string;
  partsCreated: number;
  partsUpdated: number;
  needsGrading: number;
  photos: ScannedPhotoSummary[];
  unresolved: UnresolvedDetection[];
  roster: {
    expected: string[];
    found: string[];
    missing: string[];
    /** True when the VIN decode was incomplete, so `expected` is a floor. */
    approximate: boolean;
    doors: number | null;
    bodyClass: string | null;
  };
}

/**
 * Runs multi-part AI detection over photos of this vehicle and files the
 * results as graded inventory.
 *
 * Either pass `blobs` to scan new photos, or set `useExistingImages` to
 * re-run over the walkaround photos already stored on the vehicle (those
 * are never AI-analysed at upload time). Takes 20-40s for a typical
 * walkaround -- callers must show progress.
 */
export function scanVehicle(
  token: string,
  vehicleId: string,
  options: { blobs?: Blob[]; useExistingImages?: boolean },
  fetchImpl?: typeof fetch,
): Promise<VehicleScanSummary> {
  const formData = new FormData();
  if (options.useExistingImages) {
    formData.append("useExistingImages", "true");
  }
  (options.blobs ?? []).forEach((blob, i) => {
    formData.append("files", blob, `scan-${i}.jpg`);
  });
  return authFetch<VehicleScanSummary>(
    `/vehicles/${vehicleId}/scan`,
    { token, method: "POST", body: formData },
    fetchImpl,
  );
}

export interface VehicleDeletionSummary {
  vehicleId: string;
  vin: string;
  deletedParts: number;
  deletedPhotos: number;
}

/**
 * Permanently deletes a vehicle added by mistake, plus its parts, photos,
 * AI grades and the human corrections on them. Manager/owner only, and
 * there is no undo -- callers must confirm first.
 */
export function deleteVehicle(
  token: string,
  vehicleId: string,
  fetchImpl?: typeof fetch,
): Promise<VehicleDeletionSummary> {
  return authFetch<VehicleDeletionSummary>(
    `/vehicles/${vehicleId}`,
    { token, method: "DELETE" },
    fetchImpl,
  );
}

/** Adds another photo to a part that already exists server-side (re-shoot). */
export function addPartImage(
  token: string,
  partId: string,
  blob: Blob,
  fetchImpl?: typeof fetch,
): Promise<{ id: string; url: string }> {
  const formData = new FormData();
  formData.append("file", blob, "part.jpg");
  return authFetch<{ id: string; url: string }>(
    `/parts/${partId}/images`,
    { token, method: "POST", body: formData },
    fetchImpl,
  );
}
