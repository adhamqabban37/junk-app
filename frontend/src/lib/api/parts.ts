import { authFetch, apiBaseUrl } from "../api";

export type PartStatus =
  | "pending_ai"
  | "pending_review"
  | "needs_manual_grading"
  | "approved"
  | "listed"
  | "sold";

export interface PartLatestAnalysis {
  id: string;
  grade: "A" | "B" | "C" | null;
  damageCodes: string[];
  confidence: number | string | null;
  status: "pending" | "complete" | "failed";
}

export interface PartListItem {
  id: string;
  status: PartStatus;
  createdAt: string;
  taxonomyId: string;
  taxonomyName: string | null;
  vehicle: { id: string; vin: string; make: string | null; model: string | null; year: number | null } | null;
  photosCount: number;
  /** Earliest PartImage id, for a Review Queue thumbnail -- "the photo AI chose that part from." Null for a manually-added part with no photo. */
  firstImageId: string | null;
  latestAnalysis: PartLatestAnalysis | null;
}

export interface PartListResult {
  items: PartListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PartDetail {
  id: string;
  status: PartStatus;
  createdAt: string;
  taxonomyId: string;
  taxonomyName: string | null;
  vehicle: { id: string; vin: string; make: string | null; model: string | null; year: number | null } | null;
  photos: Array<{ id: string; url: string }>;
  latestAnalysis: (PartLatestAnalysis & { rawJson: Record<string, unknown> | null }) | null;
}

export function listParts(
  token: string,
  params: { status?: PartStatus[]; page?: number; pageSize?: number; vehicleId?: string } = {},
  fetchImpl?: typeof fetch,
): Promise<PartListResult> {
  const query = new URLSearchParams();
  if (params.status?.length) query.set("status", params.status.join(","));
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.vehicleId) query.set("vehicleId", params.vehicleId);
  const qs = query.toString();
  return authFetch<PartListResult>(`/parts${qs ? `?${qs}` : ""}`, { token }, fetchImpl);
}

export function getPart(token: string, id: string, fetchImpl?: typeof fetch): Promise<PartDetail> {
  return authFetch<PartDetail>(`/parts/${id}`, { token }, fetchImpl);
}

export function approvePart(token: string, id: string, fetchImpl?: typeof fetch): Promise<{ status: string }> {
  return authFetch<{ status: string }>(`/parts/${id}/approve`, { token, method: "POST" }, fetchImpl);
}

/** Re-runs AI grading from scratch on every photo already on this part -- bypasses the normal "already complete" skip, so it actually calls Gemini again instead of being a no-op. */
export function regradePart(token: string, id: string, fetchImpl?: typeof fetch): Promise<{ status: string }> {
  return authFetch<{ status: string }>(`/parts/${id}/regrade`, { token, method: "POST" }, fetchImpl);
}

/** Manager backstop for the AI still splitting one physical part into several Parts (duplicate-detection isn't perfect across separate upload sessions/sections) -- folds sourcePartIds' photos and grades onto `id`, then deletes the source Parts. Returns the merged part's fresh detail. */
export function mergeParts(
  token: string,
  id: string,
  sourcePartIds: string[],
  fetchImpl?: typeof fetch,
): Promise<PartDetail> {
  return authFetch<PartDetail>(
    `/parts/${id}/merge`,
    {
      token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourcePartIds }),
    },
    fetchImpl,
  );
}

/** Not JSON, so it goes through plain fetch rather than authFetch's parseJsonOrThrow -- mirrors fetchVehiclePhotoBlob. */
export async function fetchPartImageBlob(
  token: string,
  partId: string,
  imageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const res = await fetchImpl(`${apiBaseUrl()}/parts/${partId}/images/${imageId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Fetching part image failed with status ${res.status}`);
  }
  return res.blob();
}

/** Not JSON, so it goes through plain fetch rather than authFetch's parseJsonOrThrow. */
export async function exportPartsCsvUrl(token: string): Promise<Blob> {
  const res = await fetch(`${apiBaseUrl()}/parts/export.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`CSV export failed with status ${res.status}`);
  }
  return res.blob();
}
