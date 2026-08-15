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
  // 3001, not 3000: matches backend/src/main.ts's default listen port,
  // chosen specifically to not collide with this app's own dev server port.
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
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

export interface AuthFetchOptions extends Omit<RequestInit, "headers"> {
  token: string;
  headers?: Record<string, string>;
}

/** Shared by every desktop-dashboard resource client (vehicles, parts, users, settings, corrections). */
export async function authFetch<T>(
  path: string,
  { token, headers, ...init }: AuthFetchOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: { ...headers, Authorization: `Bearer ${token}` },
  });
  return parseJsonOrThrow<T>(res);
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

export interface DetectedPartResponse {
  /** Raw free text from the model, shown so the worker sees what it saw. */
  partName: string;
  /** Null when the model's wording is ambiguous or has no taxonomy row. */
  taxonomyId: string | null;
  taxonomyName: string | null;
  /** Non-empty only when ambiguous -- the rows worth choosing between. */
  candidateIds: string[];
  grade: "A" | "B" | "C" | "D";
  damageCodes: string[];
  confidence: number;
}

export interface DetectedImageResponse {
  index: number;
  detections: DetectedPartResponse[];
  error?: string;
}

/**
 * Bulk scene detection: many photos in, every part the AI can identify in
 * each one out, already graded.
 *
 * Requires a connection, unlike the rest of intake. The detection itself
 * cannot happen on-device, and it has to happen before the worker can
 * confirm anything -- so there is nothing useful to queue offline. What the
 * worker CONFIRMS still lands in the IndexedDB draft and syncs through the
 * normal offline path, so only this one step needs the network.
 */
/**
 * Photos per request to the AI endpoints.
 *
 * The server caps each request (multer rejects the whole upload past its
 * limit), so a worker with a big walkaround would otherwise get a hard
 * failure rather than a slower answer. Chunking here means the number of
 * photos a worker may take is not limited by a request size — they upload
 * what they have, and this splits it up.
 *
 * Kept at or below the smallest server-side cap so a chunk can never be
 * the thing that fails.
 */
const AI_BATCH_SIZE = 12;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs `send` over the files in batches and stitches the results back into
 * one list, correcting each result's `index` to its position in the ORIGINAL
 * array. Every caller keys results back to a photo by index, so leaving the
 * per-chunk indices in place would attach batch 2's parts to batch 1's
 * photos — silently, and with no error anywhere.
 */
async function inBatches<T extends { index: number }>(
  files: Blob[],
  send: (batch: Blob[]) => Promise<T[]>,
): Promise<T[]> {
  const batches = chunk(files, AI_BATCH_SIZE);
  const results: T[] = [];
  let offset = 0;
  for (const batch of batches) {
    const batchResults = await send(batch);
    for (const item of batchResults) {
      results.push({ ...item, index: item.index + offset });
    }
    offset += batch.length;
  }
  return results;
}

export async function detectParts(
  token: string,
  files: Blob[],
  fetchImpl: typeof fetch = fetch,
): Promise<DetectedImageResponse[]> {
  return inBatches(files, async (batch) => {
    const form = new FormData();
    batch.forEach((file, i) => form.append("files", file, `scene-${i}.jpg`));
    const res = await fetchImpl(`${apiBaseUrl()}/ai/detect-parts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = await parseJsonOrThrow<{ images: DetectedImageResponse[] }>(res);
    return body.images;
  });
}

export interface ClassifiedImageResponse {
  index: number;
  angle: "front" | "rear" | "left" | "right" | "unknown";
  confidence: number;
  note: string | null;
  error?: string;
}

/**
 * Sorts a bulk drop of walkaround photos into front/rear/left/right.
 *
 * Best-effort, unlike detectParts(): the caller keeps every photo either
 * way and only uses this to pre-fill the angles. If it throws -- offline, or
 * the API is down -- the photos are still in the draft with no angle and the
 * worker assigns them by hand. That is what keeps the exterior step working
 * offline, which the rest of intake depends on.
 */
export async function classifyVehiclePhotos(
  token: string,
  files: Blob[],
  fetchImpl: typeof fetch = fetch,
): Promise<ClassifiedImageResponse[]> {
  return inBatches(files, async (batch) => {
    const form = new FormData();
    batch.forEach((file, i) => form.append("files", file, `vehicle-${i}.jpg`));
    const res = await fetchImpl(`${apiBaseUrl()}/ai/classify-vehicle-photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const body = await parseJsonOrThrow<{ images: ClassifiedImageResponse[] }>(res);
    return body.images;
  });
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
