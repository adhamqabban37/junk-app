import { test, expect } from "@playwright/test";

// Modern Lighthouse (v10+) removed its scored "pwa" category entirely --
// see the comment in scripts/lighthouse-audit.mjs. These are the actual
// technical criteria that score used to represent, checked directly.

test.describe("PWA installability", () => {
  test("serves a valid, linked web app manifest", async ({ page }) => {
    await page.goto("/login");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/manifest.webmanifest");

    const res = await page.request.get(manifestHref!);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons) && manifest.icons.length).toBeGreaterThan(0);

    // Every declared icon must actually resolve, not just be listed.
    for (const icon of manifest.icons) {
      const iconRes = await page.request.get(icon.src);
      expect(iconRes.ok(), `icon ${icon.src} should load`).toBe(true);
    }
  });

  test("registers a service worker that takes control of the page", async ({ page }) => {
    await page.goto("/login");

    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return Boolean(reg?.active);
      },
      { timeout: 10000 },
    );

    // sw.js calls clients.claim() in its activate handler specifically so
    // the very first page that registered it doesn't need a reload to be
    // controlled -- but that claim still needs a moment to propagate after
    // `active` flips true, so poll for .controller rather than checking it
    // the instant registration resolves.
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 10000 });

    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(controlled).toBe(true);
  });

  test("serves the service worker script itself with real content", async ({ page }) => {
    const res = await page.request.get("/sw.js");
    expect(res.ok()).toBe(true);
    const body = await res.text();
    expect(body).toContain("addEventListener");
  });
});
