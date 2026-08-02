import { authFetch } from "../api";

export function recordCorrection(
  token: string,
  aiAnalysisId: string,
  field: string,
  correctedValue: string,
  fetchImpl?: typeof fetch,
): Promise<{ id: string }> {
  return authFetch<{ id: string }>(
    `/ai-analyses/${aiAnalysisId}/corrections`,
    {
      token,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field, correctedValue }),
    },
    fetchImpl,
  );
}
