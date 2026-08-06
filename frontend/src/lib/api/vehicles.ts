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
