export interface WorkerSummary {
  id: string;
  name: string;
}

export interface TaxonomyItemResponse {
  id: string;
  name: string;
  category: string;
  isQuickPick: boolean;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (body.message) {
        message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
      }
    } catch {
      // Body wasn't JSON (or was empty) — fall back to the generic message above.
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export async function listWorkers(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkerSummary[]> {
  const res = await fetchImpl(`${apiBaseUrl()}/auth/tenants/${tenantId}/workers`);
  return parseJsonOrThrow<WorkerSummary[]>(res);
}

export async function loginPin(
  tenantId: string,
  userId: string,
  pin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${apiBaseUrl()}/auth/login/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, userId, pin }),
  });
  const body = await parseJsonOrThrow<{ accessToken: string }>(res);
  return body.accessToken;
}

export async function fetchTaxonomy(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TaxonomyItemResponse[]> {
  const res = await fetchImpl(`${apiBaseUrl()}/taxonomy`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseJsonOrThrow<TaxonomyItemResponse[]>(res);
}

export async function loginManager(
  tenantId: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(`${apiBaseUrl()}/auth/login/manager`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, password }),
  });
  const body = await parseJsonOrThrow<{ accessToken: string }>(res);
  return body.accessToken;
}
