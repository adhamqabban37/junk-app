import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

function base64url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeManagerJwt(): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ sub: "perf-manager", tenantId: "perf-tenant", role: "manager", name: "Perf Manager" }),
  );
  // Signature is never verified client-side (auth-session.ts only decodes
  // the payload) -- a real signature isn't needed to exercise this UI.
  return `${header}.${payload}.unsigned`;
}

// Real backend caps pageSize at 1000 (ListPartsDto) -- the Inventory screen
// requests exactly that ceiling in one shot rather than paginating (see the
// PAGE_SIZE comment in inventory/page.tsx). This intercepts the real network
// call with the largest response the actual backend contract could ever
// return, so this measures the real end-to-end path, not an inflated
// fixture the app could never actually receive.
const ROW_COUNT = 1000;

function makeMockPartsResponse(count: number) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `part-${i}`,
    status: i % 3 === 0 ? "approved" : "pending_ai",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: `Part ${i}`,
    vehicle: {
      id: "v1",
      vin: `1HGCM82633A${(100000 + i).toString().padStart(6, "0")}`,
      make: "Honda",
      model: "Accord",
      year: 2005,
    },
    photosCount: 1,
    latestAnalysis: null,
  }));
  return { items, total: count, page: 1, pageSize: count };
}

test("Inventory virtualized table stays within a frame-time budget while scrolling 1000 rows", async ({
  page,
  context,
}) => {
  await context.addInitScript((token) => {
    window.localStorage.setItem("junkyard:accessToken", token);
  }, fakeManagerJwt());

  await page.route("**/parts?**", async (route) => {
    await route.fulfill({ json: makeMockPartsResponse(ROW_COUNT) });
  });

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByText("Part 0")).toBeVisible();

  const rowsBeforeScroll = await page.getByRole("row").count();
  expect(rowsBeforeScroll).toBeLessThan(50);

  // Long tasks (>50ms of blocked main thread) are the standard web-vitals
  // proxy for "does scrolling actually stay smooth" -- this is what
  // Lighthouse's own TBT metric is built on, and is a more meaningful
  // signal here than parsing raw frame timestamps out of a trace file by
  // hand.
  await page.evaluate(() => {
    (window as unknown as { __longTasks: number[] }).__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as unknown as { __longTasks: number[] }).__longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });

  const tracesDir = path.resolve(__dirname, "..", "test-results", "traces");
  fs.mkdirSync(tracesDir, { recursive: true });
  await context.tracing.start({ screenshots: true, snapshots: true });

  const scrollContainer = page.getByTestId("inventory-scroll-container");
  for (let i = 0; i < 20; i++) {
    await scrollContainer.evaluate((el, step) => {
      el.scrollTop += step;
    }, ROW_COUNT); // scroll by ~ROW_COUNT px each step -- sweeps the full list over 20 steps
    await page.waitForTimeout(50);
  }

  const rowsAfterScroll = await page.getByRole("row").count();

  const tracePath = path.join(tracesDir, "inventory-virtualization-trace.zip");
  await context.tracing.stop({ path: tracePath });

  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);

  console.log(
    `[inventory-virtualization] rows in DOM: before=${rowsBeforeScroll} after=${rowsAfterScroll}/${ROW_COUNT} total, long tasks during scroll: ${longTasks.length} (${JSON.stringify(longTasks)}), trace saved to ${tracePath}`,
  );

  expect(rowsAfterScroll).toBeLessThan(50);
  // Budget: allow a small number of long tasks (browser/CI jitter) but not
  // a pattern of janky scrolling -- more than a handful across 20 scroll
  // steps means virtualization isn't actually keeping the frame budget.
  expect(longTasks.length).toBeLessThan(5);
});
