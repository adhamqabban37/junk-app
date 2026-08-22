import { authFetch, apiBaseUrl } from "../api";

export interface VehiclePhotoSummary {
  id: string;
  createdAt: string;
}

export function listVehiclePhotos(
  token: string,
  vehicleId: string,
  fetchImpl?: typeof fetch,
): Promise<VehiclePhotoSummary[]> {
  return authFetch<VehiclePhotoSummary[]>(`/vehicles/${vehicleId}/photos`, { token }, fetchImpl);
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
