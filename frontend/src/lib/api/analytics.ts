import { authFetch } from "../api";

export interface AnalyticsSummary {
  totalVehicles: number;
  totalParts: number;
  partsByStatus: Record<string, number>;
  gradeDistribution: Record<string, number>;
  vehiclesByCrushStatus: Record<string, number>;
}

export function getAnalytics(token: string, fetchImpl?: typeof fetch): Promise<AnalyticsSummary> {
  return authFetch<AnalyticsSummary>("/analytics", { token }, fetchImpl);
}
