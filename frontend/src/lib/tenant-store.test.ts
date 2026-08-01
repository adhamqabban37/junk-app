import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTenantStore } from "./tenant-store";
import { clearTenantId } from "./tenant";

describe("useTenantStore", () => {
  beforeEach(() => {
    useTenantStore.setState({ tenantId: null, hydrated: false });
  });

  afterEach(() => {
    clearTenantId();
  });

  it("hydrate reads null when no tenant is bound yet", () => {
    useTenantStore.getState().hydrate();
    expect(useTenantStore.getState()).toMatchObject({ tenantId: null, hydrated: true });
  });

  it("bind persists the tenant id and updates state", () => {
    useTenantStore.getState().bind("11111111-1111-1111-1111-111111111111");
    expect(useTenantStore.getState().tenantId).toBe("11111111-1111-1111-1111-111111111111");

    useTenantStore.setState({ tenantId: null, hydrated: false });
    useTenantStore.getState().hydrate();
    expect(useTenantStore.getState().tenantId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("bind throws on an invalid tenant id and leaves state unchanged", () => {
    expect(() => useTenantStore.getState().bind("not-a-uuid")).toThrow();
    expect(useTenantStore.getState().tenantId).toBeNull();
  });

  it("unbind clears the persisted tenant id", () => {
    useTenantStore.getState().bind("11111111-1111-1111-1111-111111111111");
    useTenantStore.getState().unbind();
    expect(useTenantStore.getState().tenantId).toBeNull();
  });
});
