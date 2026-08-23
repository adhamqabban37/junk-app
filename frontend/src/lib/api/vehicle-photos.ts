import { authFetch, apiBaseUrl } from "../api";

export interface VehiclePhotoSuggestion {
  taxonomyId: string;
  taxonomyName: string | null;
  confidence: number | string;
}

/** Optional, worker-applied tag for a *batch* of photos uploaded together -- never required, never per-photo. See the backend entity's own doc comment for why. */
export type VehiclePhotoSection =
  | "front"
  | "rear"
  | "driver_side"
  | "passenger_side"
  | "interior"
  | "undercarriage";

export const VEHICLE_PHOTO_SECTIONS: { value: VehiclePhotoSection; label: string }[] = [
  { value: "front", label: "Front" },
  { value: "rear", label: "Rear" },
  { value: "driver_side", label: "Driver side" },
  { value: "passenger_side", label: "Passenger side" },
  { value: "interior", label: "Interior" },
  { value: "undercarriage", label: "Undercarriage" },
];

export interface VehiclePhotoSummary {
  id: string;
  createdAt: string;
  section: VehiclePhotoSection | null;
  /** Every distinct part AI identified in this photo -- a photo can show more than one (headlight + bumper + fender in one frame), so this is a list. Each is a hint the manager confirms via Assign, never auto-applied below the confidence threshold. Empty if ungraded yet or nothing from the candidate list was visible. */
  suggestions: VehiclePhotoSuggestion[];
}

export function listVehiclePhotos(
  token: string,
  vehicleId: string,
  fetchImpl?: typeof fetch,
): Promise<VehiclePhotoSummary[]> {
  return authFetch<VehiclePhotoSummary[]>(`/vehicles/${vehicleId}/photos`, { token }, fetchImpl);
}

/**
 * Lets a worker attach more raw photos to a vehicle they already sent, any
 * time afterward -- not just at initial intake. Same `photo:{id}` field-name
 * convention as the intake sync's own multipart body (sync.ts), so it can
 * reuse the exact same on-device capture pipeline.
 */
export function addVehiclePhotos(
  token: string,
  vehicleId: string,
  photos: { id: string; blob: Blob }[],
  section?: VehiclePhotoSection,
  fetchImpl?: typeof fetch,
): Promise<VehiclePhotoSummary[]> {
  const formData = new FormData();
  for (const photo of photos) {
    formData.append(`photo:${photo.id}`, photo.blob, `${photo.id}.jpg`);
  }
  if (section) formData.append("section", section);
  return authFetch<VehiclePhotoSummary[]>(
    `/vehicles/${vehicleId}/photos`,
    { token, method: "POST", body: formData },
    fetchImpl,
  );
}

export function assignVehiclePhotos(
  token: string,
  vehicleId: string,
  photoIds: string[],
  taxonomyId: string,
  fetchImpl?: typeof fetch,
): Promise<{ partId: string }> {
  return authFetch<{ partId: string }>(
    `/vehicles/${vehicleId}/photos/assign`,
    {
      token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds, taxonomyId }),
    },
    fetchImpl,
  );
}

/** Not JSON, so it goes through plain fetch rather than authFetch's parseJsonOrThrow -- mirrors exportPartsCsvUrl. */
export async function fetchVehiclePhotoBlob(
  token: string,
  vehicleId: string,
  photoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const res = await fetchImpl(`${apiBaseUrl()}/vehicles/${vehicleId}/photos/${photoId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Fetching photo failed with status ${res.status}`);
  }
  return res.blob();
}
