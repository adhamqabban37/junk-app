import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./pwa";

describe("registerServiceWorker", () => {
  const originalServiceWorker = navigator.serviceWorker;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: originalServiceWorker,
      configurable: true,
    });
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
    vi.unstubAllEnvs();
  });

  it("registers /sw.js when the browser supports service workers", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("does nothing when the browser doesn't support service workers", () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
    });

    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("in development, registers nothing and tears down any service worker already installed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = vi.fn().mockResolvedValue(undefined);
    const unregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register, getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
      configurable: true,
    });
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["junkyard-static-v1", "junkyard-pages-v1"]),
      delete: cacheDelete,
    });

    registerServiceWorker();

    // The stale copy is what actually causes the recurring reload loop --
    // never registering a new one is only half the fix.
    await vi.waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
    expect(cacheDelete).toHaveBeenCalledWith("junkyard-static-v1");
    expect(cacheDelete).toHaveBeenCalledWith("junkyard-pages-v1");
    expect(register).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
