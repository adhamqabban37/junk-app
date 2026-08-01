import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests, getCachedTaxonomy } from "./db";
import { useTaxonomyStore } from "./taxonomy-store";

describe("useTaxonomyStore", () => {
  beforeEach(() => {
    useTaxonomyStore.setState({ items: [], hydrated: false });
  });

  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("hydrate loads whatever was previously cached, for offline availability", async () => {
    const { putTaxonomy } = await import("./db");
    await putTaxonomy([
      { id: "t1", name: "Alternator", category: "Electrical", isQuickPick: true },
    ]);

    await useTaxonomyStore.getState().hydrate();

    expect(useTaxonomyStore.getState().items).toEqual([
      { id: "t1", name: "Alternator", category: "Electrical", isQuickPick: true },
    ]);
    expect(useTaxonomyStore.getState().hydrated).toBe(true);
  });

  it("refresh fetches from the API, updates state, and persists to the cache", async () => {
    const fetchTaxonomy = vi.fn().mockResolvedValue([
      { id: "t2", name: "Starter", category: "Electrical", isQuickPick: false },
    ]);

    await useTaxonomyStore.getState().refresh("jwt-token", fetchTaxonomy);

    expect(fetchTaxonomy).toHaveBeenCalledWith("jwt-token");
    expect(useTaxonomyStore.getState().items).toEqual([
      { id: "t2", name: "Starter", category: "Electrical", isQuickPick: false },
    ]);
    expect(await getCachedTaxonomy()).toEqual([
      { id: "t2", name: "Starter", category: "Electrical", isQuickPick: false },
    ]);
  });

  it("refresh failing (offline) leaves whatever was already cached/hydrated in place", async () => {
    const { putTaxonomy } = await import("./db");
    await putTaxonomy([
      { id: "t1", name: "Alternator", category: "Electrical", isQuickPick: true },
    ]);
    await useTaxonomyStore.getState().hydrate();

    const fetchTaxonomy = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(
      useTaxonomyStore.getState().refresh("jwt-token", fetchTaxonomy),
    ).resolves.toBeUndefined();

    expect(useTaxonomyStore.getState().items).toEqual([
      { id: "t1", name: "Alternator", category: "Electrical", isQuickPick: true },
    ]);
  });
});
