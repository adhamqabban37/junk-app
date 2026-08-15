import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  authFetch,
  classifyVehiclePhotos,
  detectParts,
  fetchTaxonomy,
  listWorkers,
  loginManager,
  loginPin,
} from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("listWorkers", () => {
  it("returns the worker list for a tenant", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: "w1", name: "Worker One" }]));

    const workers = await listWorkers("tenant-1", fetchMock);

    expect(workers).toEqual([{ id: "w1", name: "Worker One" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/tenants/tenant-1/workers"),
    );
  });
});

describe("loginPin", () => {
  it("returns the access token on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: "jwt-token" }));
    const token = await loginPin("tenant-1", "worker-1", "1234", fetchMock);
    expect(token).toBe("jwt-token");
  });

  it("throws ApiError with the backend's message on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ statusCode: 401, message: "Invalid worker or PIN" }, 401));

    await expect(loginPin("tenant-1", "worker-1", "0000", fetchMock)).rejects.toMatchObject({
      message: "Invalid worker or PIN",
      status: 401,
    });
  });

  it("throws ApiError even if the error body isn't valid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );
    await expect(loginPin("tenant-1", "worker-1", "1234", fetchMock)).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe("fetchTaxonomy", () => {
  it("sends the bearer token and returns the taxonomy list", async () => {
    const items = [{ id: "t1", name: "Alternator", category: "Electrical", isQuickPick: true }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(items));

    const result = await fetchTaxonomy("jwt-token", fetchMock);

    expect(result).toEqual(items);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
  });

  it("throws ApiError on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Unauthorized" }, 401));
    await expect(fetchTaxonomy("bad-token", fetchMock)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("authFetch", () => {
  it("sends the bearer token, JSON content-type for a body, and parses the JSON response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));

    const result = await authFetch<{ ok: boolean }>(
      "/parts/123/approve",
      { token: "jwt-token", method: "POST" },
      fetchMock,
    );

    expect(result).toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/parts/123/approve");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer jwt-token");
  });

  it("throws ApiError with the backend's message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Forbidden" }, 403));
    await expect(
      authFetch("/vehicles", { token: "bad-token" }, fetchMock),
    ).rejects.toMatchObject({ message: "Forbidden", status: 403 });
  });
});

describe("loginManager", () => {
  it("returns the access token on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accessToken: "jwt-token" }));
    const token = await loginManager("tenant-1", "manager@yard.local", "hunter2", fetchMock);
    expect(token).toBe("jwt-token");
  });

  it("throws ApiError with the backend's message on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ statusCode: 401, message: "Invalid email or password" }, 401));

    await expect(
      loginManager("tenant-1", "manager@yard.local", "wrong", fetchMock),
    ).rejects.toMatchObject({ message: "Invalid email or password", status: 401 });
  });
});

// A worker's walkaround is however many photos they took. The server caps
// each request, so without batching a large set failed outright instead of
// just taking longer -- and the index arithmetic below is what stops batch
// 2's results being attached to batch 1's photos, which would be silent.
describe("AI endpoints batch large photo sets", () => {
  function blobs(n: number): Blob[] {
    return Array.from({ length: n }, () => new Blob(["x"], { type: "image/jpeg" }));
  }

  it("sends one request when the set is small", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ images: [{ index: 0, detections: [] }] }),
    );

    const images = await detectParts("t", blobs(1), fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(images).toHaveLength(1);
  });

  it("splits a set larger than one request and renumbers the results", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const count = (init.body as FormData).getAll("files").length;
      // Each batch numbers its own images from 0 -- exactly what has to be
      // corrected on the way out.
      return Promise.resolve(
        jsonResponse({
          images: Array.from({ length: count }, (_, i) => ({ index: i, detections: [] })),
        }),
      );
    });

    const images = await detectParts("t", blobs(15), fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(images).toHaveLength(15);
    // Contiguous 0..14, not 0..11 followed by 0..2.
    expect(images.map((i) => i.index)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    );
  });

  it("batches angle classification the same way", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const count = (init.body as FormData).getAll("files").length;
      return Promise.resolve(
        jsonResponse({
          images: Array.from({ length: count }, (_, i) => ({
            index: i,
            angle: "front",
            confidence: 0.9,
            note: null,
          })),
        }),
      );
    });

    const images = await classifyVehiclePhotos("t", blobs(20), fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(images.map((i) => i.index)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it("does not call the API at all for an empty set", async () => {
    const fetchMock = vi.fn();

    const images = await detectParts("t", [], fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(images).toEqual([]);
  });
});
