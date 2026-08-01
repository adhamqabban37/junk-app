import { afterEach, describe, expect, it } from "vitest";
import { clearTenantId, getTenantId, setTenantId } from "./tenant";

describe("tenant device binding", () => {
  afterEach(() => {
    clearTenantId();
  });

  it("returns null when no tenant has been bound to this device yet", () => {
    expect(getTenantId()).toBeNull();
  });

  it("persists a bound tenant id across calls", () => {
    setTenantId("11111111-1111-1111-1111-111111111111");
    expect(getTenantId()).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects a non-UUID value", () => {
    expect(() => setTenantId("not-a-uuid")).toThrow();
  });

  it("clearTenantId un-binds the device", () => {
    setTenantId("11111111-1111-1111-1111-111111111111");
    clearTenantId();
    expect(getTenantId()).toBeNull();
  });
});
