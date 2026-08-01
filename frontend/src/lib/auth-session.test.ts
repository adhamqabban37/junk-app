import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthSession } from "./auth-session";

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("useAuthSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthSession.setState({ token: null, claims: null, restored: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("login decodes JWT claims and persists the token", () => {
    const token = makeJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "manager",
      name: "Manager A",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    useAuthSession.getState().login(token);

    expect(useAuthSession.getState().token).toBe(token);
    expect(useAuthSession.getState().claims).toMatchObject({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "manager",
      name: "Manager A",
    });
    expect(window.localStorage.getItem("junkyard:accessToken")).toBe(token);
  });

  it("restore reads a previously-persisted token back into state (offline PWA relaunch)", () => {
    const token = makeJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "worker",
      name: "Worker A",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    window.localStorage.setItem("junkyard:accessToken", token);

    useAuthSession.getState().restore();

    expect(useAuthSession.getState().token).toBe(token);
    expect(useAuthSession.getState().claims?.sub).toBe("user-1");
    expect(useAuthSession.getState().restored).toBe(true);
  });

  it("restore discards an expired token instead of treating it as a valid session", () => {
    const expiredToken = makeJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "worker",
      name: "Worker A",
      exp: Math.floor(Date.now() / 1000) - 3600,
    });
    window.localStorage.setItem("junkyard:accessToken", expiredToken);

    useAuthSession.getState().restore();

    expect(useAuthSession.getState().token).toBeNull();
    expect(useAuthSession.getState().claims).toBeNull();
    expect(window.localStorage.getItem("junkyard:accessToken")).toBeNull();
  });

  it("restore marks the session restored even when nothing was ever persisted", () => {
    useAuthSession.getState().restore();
    expect(useAuthSession.getState().token).toBeNull();
    expect(useAuthSession.getState().restored).toBe(true);
  });

  it("logout clears both memory and localStorage", () => {
    const token = makeJwt({
      sub: "user-1",
      tenantId: "tenant-1",
      role: "worker",
      name: "Worker A",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    useAuthSession.getState().login(token);

    useAuthSession.getState().logout();

    expect(useAuthSession.getState().token).toBeNull();
    expect(useAuthSession.getState().claims).toBeNull();
    expect(window.localStorage.getItem("junkyard:accessToken")).toBeNull();
  });
});
