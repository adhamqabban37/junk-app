import { describe, expect, it, vi } from "vitest";
import { decodeVin, VinDecodeError } from "./nhtsa";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("decodeVin", () => {
  it("extracts make/model/year/trim from NHTSA's flat Results array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Results: [
          { Variable: "Make", Value: "HONDA" },
          { Variable: "Model", Value: "Accord" },
          { Variable: "Model Year", Value: "2003" },
          { Variable: "Trim", Value: "EX" },
          { Variable: "Error Code", Value: "0" },
        ],
      }),
    );

    const result = await decodeVin("1HGCM82633A123456", fetchMock);

    expect(result).toEqual({
      make: "HONDA",
      model: "Accord",
      year: 2003,
      trim: "EX",
      raw: expect.any(Object),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("1HGCM82633A123456"),
    );
  });

  it("treats blank string values from NHTSA as null, not empty strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Results: [
          { Variable: "Make", Value: "HONDA" },
          { Variable: "Model", Value: "Accord" },
          { Variable: "Model Year", Value: "2003" },
          { Variable: "Trim", Value: "" },
        ],
      }),
    );

    const result = await decodeVin("1HGCM82633A123456", fetchMock);
    expect(result.trim).toBeNull();
  });

  it("throws VinDecodeError when the network request itself fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(decodeVin("1HGCM82633A123456", fetchMock)).rejects.toThrow(VinDecodeError);
  });

  it("throws VinDecodeError on a non-2xx HTTP status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ Results: [] }, 503));
    await expect(decodeVin("1HGCM82633A123456", fetchMock)).rejects.toThrow(VinDecodeError);
  });

  it("throws VinDecodeError when the response body doesn't match the expected schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ unexpected: "shape" }));
    await expect(decodeVin("1HGCM82633A123456", fetchMock)).rejects.toThrow(VinDecodeError);
  });

  it("throws VinDecodeError when NHTSA returns HTTP 200 but no usable make/model (undecodable VIN)", async () => {
    // NHTSA reports undecodable VINs as an in-body error code on a 200
    // response, not a non-2xx status — this is the case the manual-entry
    // fallback in the Vehicle Context screen depends on catching.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        Results: [
          { Variable: "Make", Value: "" },
          { Variable: "Model", Value: "" },
          { Variable: "Error Code", Value: "1,143" },
          { Variable: "Error Text", Value: "Check Digit (9th position) does not calculate properly" },
        ],
      }),
    );

    await expect(decodeVin("1HGCM82633A1XXXXX", fetchMock)).rejects.toThrow(VinDecodeError);
  });
});
