import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetDbForTests, listDrafts } from "./db";
import { useIntakeStore } from "./store";
import type { DraftPhoto } from "./types";

function makePhoto(overrides: Partial<DraftPhoto> = {}): DraftPhoto {
  return {
    id: crypto.randomUUID(),
    blob: new Blob(["fake-image-bytes"], { type: "image/jpeg" }),
    qualityFlags: { blurry: false, tooDark: false },
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("useIntakeStore", () => {
  beforeEach(() => {
    useIntakeStore.setState({ drafts: [], hydrated: false });
  });

  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("creates a draft with a client-generated UUID and persists it immediately", async () => {
    const draft = await useIntakeStore.getState().createDraft();

    expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(draft.status).toBe("draft");
    expect(useIntakeStore.getState().drafts).toHaveLength(1);

    const persisted = await listDrafts();
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(draft.id);
  });

  it("two drafts created back-to-back get distinct ids (offline duplicate-record protection)", async () => {
    const a = await useIntakeStore.getState().createDraft();
    const b = await useIntakeStore.getState().createDraft();
    expect(a.id).not.toBe(b.id);
    expect(useIntakeStore.getState().drafts).toHaveLength(2);
  });

  it("records a manually-entered VIN and persists the entry method", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().setVin(draft.id, "1HGCM82633A123456", "manual");

    const updated = useIntakeStore.getState().drafts.find((d) => d.id === draft.id);
    expect(updated?.vin).toBe("1HGCM82633A123456");
    expect(updated?.vinEntryMethod).toBe("manual");

    const [persisted] = await listDrafts();
    expect(persisted.vin).toBe("1HGCM82633A123456");
  });

  it("accumulates photos without overwriting earlier ones", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().addPhoto(draft.id, makePhoto({ id: "photo-1" }));
    await useIntakeStore.getState().addPhoto(draft.id, makePhoto({ id: "photo-2" }));

    const updated = useIntakeStore.getState().drafts.find((d) => d.id === draft.id);
    expect(updated?.photos.map((p) => p.id)).toEqual(["photo-1", "photo-2"]);
  });

  it("queueForSync -> markSynced transitions status and clears prior sync errors", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().markSyncFailed(draft.id, "network error");
    await useIntakeStore.getState().queueForSync(draft.id);

    let updated = useIntakeStore.getState().drafts.find((d) => d.id === draft.id);
    expect(updated?.status).toBe("queued");
    expect(updated?.syncError).toBeUndefined();

    await useIntakeStore.getState().markSynced(draft.id);
    updated = useIntakeStore.getState().drafts.find((d) => d.id === draft.id);
    expect(updated?.status).toBe("synced");
  });

  it("hydrate loads drafts already persisted from a prior session", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    useIntakeStore.setState({ drafts: [], hydrated: false });

    await useIntakeStore.getState().hydrate();

    expect(useIntakeStore.getState().hydrated).toBe(true);
    expect(useIntakeStore.getState().drafts.map((d) => d.id)).toEqual([draft.id]);
  });

  it("removeDraft deletes from both memory and IndexedDB", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().removeDraft(draft.id);

    expect(useIntakeStore.getState().drafts).toHaveLength(0);
    expect(await listDrafts()).toHaveLength(0);
  });
});
