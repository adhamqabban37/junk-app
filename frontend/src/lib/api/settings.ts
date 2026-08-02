import { authFetch } from "../api";

export interface TenantSettings {
  aiConfidenceThreshold: number;
}

export function getSettings(token: string, fetchImpl?: typeof fetch): Promise<TenantSettings> {
  return authFetch<TenantSettings>("/settings", { token }, fetchImpl);
}

export function updateSettings(
  token: string,
  settings: TenantSettings,
  fetchImpl?: typeof fetch,
): Promise<TenantSettings> {
  return authFetch<TenantSettings>(
    "/settings",
    {
      token,
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    },
    fetchImpl,
  );
}
