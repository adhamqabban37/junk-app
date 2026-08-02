import { describe, expect, it, vi } from "vitest";
import { approvePart, exportPartsCsvUrl, getPart, listParts } from "./parts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("listParts", () => {
  it("joins multiple statuses with a comma", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, pageSize: 50 }));
    await listParts("token", { status: ["pending_review", "needs_manual_grading"] }, fetchMock);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("status=pending_review%2Cneeds_manual_grading");
  });
});

describe("getPart", () => {
  it("fetches a single part", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p1" }));
    const result = await getPart("token", "p1", fetchMock);
    expect(result).toMatchObject({ id: "p1" });
  });
});

describe("approvePart", () => {
  it("posts to the approve endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "approved" }));
    const result = await approvePart("token", "p1", fetchMock);
    expect(result).toEqual({ status: "approved" });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/parts/p1/approve");
    expect(options.method).toBe("POST");
  });
});

describe("exportPartsCsvUrl", () => {
  it("returns the CSV body as a blob when the request succeeds", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(
      new Response("id,vin\n1,ABC\n", { status: 200, headers: { "content-type": "text/csv" } }),
    );
    try {
      const blob = await exportPartsCsvUrl("token");
      expect(blob.type).toContain("text/csv");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws when the export request fails", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    try {
      await expect(exportPartsCsvUrl("token")).rejects.toThrow();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
