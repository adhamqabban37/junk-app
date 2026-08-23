import { authFetch } from "../api";

export type CrushStatus = "active" | "stripped" | "crushed";

export type VehicleGrade = "A" | "B" | "C";

/** The vehicle's current whole-vehicle condition grade -- distinct from a Part's own AI analysis. Null status/grade fields mean grading hasn't completed yet. */
export interface VehicleGradeSummary {
  grade: VehicleGrade | null;
  status: "pending" | "complete" | "failed";
  photoCount: number;
}

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
  latestGrade: VehicleGradeSummary | null;
  firstPhotoId: string | null;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VehicleAnalysisDetail {
  id: string;
  grade: VehicleGrade | null;
  damageCodes: string[];
  confidence: number | string | null;
  photoCount: number;
  status: "pending" | "complete" | "failed";
  createdAt: string;
}

export interface VehicleDetail extends VehicleListItem {
  parts: Array<{ id: string; status: string; taxonomyId: string; createdAt: string }>;
  latestVehicleAnalysis: VehicleAnalysisDetail | null;
}

export interface MyVehicleListItem extends VehicleListItem {
  unassignedPhotosCount: number;
}

export interface MyVehicleListResult {
  items: MyVehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
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

/** The mobile worker's own "sent vehicles" list -- GET /vehicles/mine, scoped server-side to the caller. */
export function listMyVehicles(
  token: string,
  params: { page?: number; pageSize?: number } = {},
  fetchImpl?: typeof fetch,
): Promise<MyVehicleListResult> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  const qs = query.toString();
  return authFetch<MyVehicleListResult>(`/vehicles/mine${qs ? `?${qs}` : ""}`, { token }, fetchImpl);
}

export function getVehicle(token: string, id: string, fetchImpl?: typeof fetch): Promise<VehicleDetail> {
  return authFetch<VehicleDetail>(`/vehicles/${id}`, { token }, fetchImpl);
}

/** Manually adds a Part with no photo -- e.g. an alternator that's inside an unphotographed engine bay. Starts at needs_manual_grading; no AI job runs since there's no image to send Gemini. */
export function createManualPart(
  token: string,
  vehicleId: string,
  taxonomyId: string,
  fetchImpl?: typeof fetch,
): Promise<{ partId: string }> {
  return authFetch<{ partId: string }>(
    `/vehicles/${vehicleId}/parts`,
    {
      token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taxonomyId }),
    },
    fetchImpl,
  );
}
