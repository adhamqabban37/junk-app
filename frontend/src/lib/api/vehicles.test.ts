import { describe, expect, it, vi } from "vitest";
import { getVehicle, listVehicles } from "./vehicles";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listVehicles", () => {
  it("builds the query string from provided filters and sends the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, pageSize: 25 }));

    await listVehicles("token", { crushStatus: "crushed", page: 2, pageSize: 10 }, fetchMock);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/vehicles?crushStatus=crushed&page=2&pageSize=10");
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("omits the query string entirely with no filters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, pageSize: 25 }));
    await listVehicles("token", {}, fetchMock);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.endsWith("/vehicles")).toBe(true);
  });
});

describe("getVehicle", () => {
  it("fetches a single vehicle by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "v1", vin: "VIN123" }));
    const result = await getVehicle("token", "v1", fetchMock);
    expect(result).toMatchObject({ id: "v1" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/vehicles/v1");
  });
});
