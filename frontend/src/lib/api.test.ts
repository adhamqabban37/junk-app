import { describe, expect, it, vi } from "vitest";
import { ApiError, listWorkers, loginManager, loginPin } from "./api";

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
