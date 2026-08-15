import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./random-id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Swaps globalThis.crypto for the duration of one test. */
function withCrypto(replacement: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: replacement,
    configurable: true,
    writable: true,
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  };
}

describe("randomId", () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  it("uses crypto.randomUUID when it is available", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    restores.push(withCrypto({ randomUUID, getRandomValues: vi.fn() }));

    expect(randomId()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalled();
  });

  /**
   * The reason this module exists. crypto.randomUUID is secure-context only,
   * so on a phone hitting the dev server at http://192.168.1.26:3000 it is
   * simply undefined -- and every intake screen threw
   * "crypto.randomUUID is not a function" on the first tap.
   */
  it("falls back to getRandomValues when randomUUID is missing (plain HTTP)", () => {
    const getRandomValues = vi.fn((array: Uint8Array) => {
      for (let i = 0; i < array.length; i += 1) array[i] = i * 7 + 3;
      return array;
    });
    restores.push(withCrypto({ getRandomValues }));

    const id = randomId();

    expect(getRandomValues).toHaveBeenCalled();
    expect(id).toMatch(V4);
  });

  it("sets the version and variant bits correctly in the fallback", () => {
    // All-zero bytes would produce an invalid UUID unless the version and
    // variant nibbles are forced -- which is exactly what the regex checks.
    restores.push(
      withCrypto({
        getRandomValues: (array: Uint8Array) => array.fill(0),
      }),
    );

    const id = randomId();

    expect(id).toMatch(V4);
    expect(id[14]).toBe("4"); // version 4
    expect(["8", "9", "a", "b"]).toContain(id[19]); // RFC 4122 variant
  });

  // Draft ids become `intakeDraftId`, which the backend uses as a per-tenant
  // idempotency key. A collision would merge two different vehicles, so
  // "never returns the same value twice" is a correctness requirement here,
  // not a nicety.
  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(ids.size).toBe(2000);
  });

  it("still produces a usable id when crypto is missing entirely", () => {
    restores.push(withCrypto(undefined));

    const id = randomId();

    expect(id).toMatch(V4);
    expect(randomId()).not.toBe(id);
  });
});
