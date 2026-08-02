import { authFetch } from "../api";

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

export interface VehicleDetail extends VehicleListItem {
  parts: Array<{ id: string; status: string; taxonomyId: string; createdAt: string }>;
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
