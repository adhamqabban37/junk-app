import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { _resetDbForTests, deleteDraft, getDraft, listDrafts, putDraft } from "./db";
import type { VehicleDraft } from "./types";

function makeDraft(overrides: Partial<VehicleDraft> = {}): VehicleDraft {
  return {
    id: "draft-1",
    vin: null,
    vinEntryMethod: null,
    decoded: null,
    exteriorPhotos: [],
    parts: [],
    status: "draft",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("offline db", () => {
  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("persists a draft and reads it back", async () => {
    const draft = makeDraft();
    await putDraft(draft);
    const read = await getDraft(draft.id);
    expect(read).toEqual(draft);
  });

  it("returns undefined for a draft that was never saved", async () => {
    const read = await getDraft("missing");
    expect(read).toBeUndefined();
  });

  it("lists all persisted drafts", async () => {
    await putDraft(makeDraft({ id: "a" }));
    await putDraft(makeDraft({ id: "b" }));
    const all = await listDrafts();
    expect(all.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("overwrites a draft with the same id instead of duplicating it", async () => {
    await putDraft(makeDraft({ id: "a", vin: "ORIGINAL1234567890".slice(0, 17) }));
    await putDraft(makeDraft({ id: "a", vin: "UPDATED12345678901".slice(0, 17) }));
    const all = await listDrafts();
    expect(all).toHaveLength(1);
    expect(all[0].vin).toBe("UPDATED12345678901".slice(0, 17));
  });

  it("deletes a draft", async () => {
    await putDraft(makeDraft({ id: "a" }));
    await deleteDraft("a");
    expect(await getDraft("a")).toBeUndefined();
  });
});
