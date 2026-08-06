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
  params: { status?: PartStatus[]; page?: number; pageSize?: number } = {},
  fetchImpl?: typeof fetch,
): Promise<PartListResult> {
  const query = new URLSearchParams();
  if (params.status?.length) query.set("status", params.status.join(","));
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return authFetch<PartListResult>(`/parts${qs ? `?${qs}` : ""}`, { token }, fetchImpl);
}

export function getPart(token: string, id: string, fetchImpl?: typeof fetch): Promise<PartDetail> {
  return authFetch<PartDetail>(`/parts/${id}`, { token }, fetchImpl);
}

/**
 * Auth is Bearer-token-based (no cookies), so a plain <img src> can't hit
 * the image endpoint directly -- it has to be fetched with the
 * Authorization header and turned into an object URL instead.
 */
export async function fetchPartImageObjectUrl(
  token: string,
  partId: string,
  imageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${apiBaseUrl()}/parts/${partId}/images/${imageId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load image (status ${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function approvePart(token: string, id: string, fetchImpl?: typeof fetch): Promise<{ status: string }> {
  return authFetch<{ status: string }>(`/parts/${id}/approve`, { token, method: "POST" }, fetchImpl);
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
