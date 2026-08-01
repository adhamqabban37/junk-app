import { z } from "zod";
import type { DecodedVehicle } from "./offline/types";

const NhtsaResponseSchema = z.object({
  Results: z.array(
    z.object({
      Variable: z.string(),
      Value: z.string().nullable(),
    }),
  ),
});

export class VinDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VinDecodeError";
  }
}

function findValue(results: { Variable: string; Value: string | null }[], variable: string): string | null {
  const value = results.find((r) => r.Variable === variable)?.Value?.trim();
  return value ? value : null;
}

/**
 * Free, unauthenticated NHTSA VIN decode API (MVP source per BUILD_PLAN).
 * `fetchImpl` is injectable for tests; defaults to the global fetch.
 */
export async function decodeVin(
  vin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DecodedVehicle> {
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`;

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new VinDecodeError("NHTSA VIN decode request failed (network)", { cause: err });
  }

  if (!response.ok) {
    throw new VinDecodeError(`NHTSA VIN decode request failed with status ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err) {
    throw new VinDecodeError("NHTSA VIN decode returned invalid JSON", { cause: err });
  }

  const parsed = NhtsaResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new VinDecodeError("NHTSA VIN decode response did not match the expected schema");
  }

  const { Results } = parsed.data;
  const make = findValue(Results, "Make");
  const model = findValue(Results, "Model");

  // NHTSA reports an undecodable VIN as an in-body error on an HTTP 200
  // response, not a non-2xx status. Whether make/model actually came back
  // is what the caller (Vehicle Context screen) needs to decide between
  // "prefill the form" and "fall back to manual entry" — the exact error
  // code text varies too much to gate on reliably.
  if (!make && !model) {
    const errorText = findValue(Results, "Error Text");
    throw new VinDecodeError(
      errorText ? `NHTSA could not decode this VIN: ${errorText}` : "NHTSA could not decode this VIN",
    );
  }

  const modelYearRaw = findValue(Results, "Model Year");
  const year = modelYearRaw ? Number.parseInt(modelYearRaw, 10) : NaN;

  return {
    make,
    model,
    year: Number.isNaN(year) ? null : year,
    trim: findValue(Results, "Trim"),
    raw: json as Record<string, unknown>,
  };
}
