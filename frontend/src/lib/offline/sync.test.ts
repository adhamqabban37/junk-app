import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetDbForTests } from "./db";
import { registerSyncTriggers, syncPendingDrafts, type SyncClient } from "./sync";
import { useIntakeStore } from "./store";
import type { VehicleDraft } from "./types";

describe("syncPendingDrafts", () => {
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

  it("syncs every queued draft and marks each synced on success", async () => {
    const a = await useIntakeStore.getState().createDraft();
    const b = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(a.id);
    await useIntakeStore.getState().queueForSync(b.id);

    const synced: string[] = [];
    const client: SyncClient = {
      syncDraft: vi.fn(async (draft: VehicleDraft) => {
        synced.push(draft.id);
      }),
    };

    await syncPendingDrafts(client);

    expect(synced.sort()).toEqual([a.id, b.id].sort());
    const drafts = useIntakeStore.getState().drafts;
    expect(drafts.find((d) => d.id === a.id)?.status).toBe("synced");
    expect(drafts.find((d) => d.id === b.id)?.status).toBe("synced");
  });

  it("leaves the draft queryable and marks it sync_failed instead of throwing when the network call fails", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);

    const client: SyncClient = {
      syncDraft: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };

    await expect(syncPendingDrafts(client)).resolves.toBeUndefined();

    const updated = useIntakeStore.getState().drafts.find((d) => d.id === draft.id);
    expect(updated?.status).toBe("sync_failed");
    expect(updated?.syncError).toBe("network unreachable");
  });

  it("retries drafts already in sync_failed state, not just queued ones", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().markSyncFailed(draft.id, "previous failure");

    const client: SyncClient = { syncDraft: vi.fn().mockResolvedValue(undefined) };
    await syncPendingDrafts(client);

    expect(client.syncDraft).toHaveBeenCalledTimes(1);
    expect(useIntakeStore.getState().drafts[0].status).toBe("synced");
  });

  it("does not touch drafts still in draft or synced state", async () => {
    const untouched = await useIntakeStore.getState().createDraft();
    const client: SyncClient = { syncDraft: vi.fn() };

    await syncPendingDrafts(client);

    expect(client.syncDraft).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().drafts.find((d) => d.id === untouched.id)?.status).toBe(
      "draft",
    );
  });
});

describe("registerSyncTriggers", () => {
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

  function setOnline(value: boolean) {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => value,
    });
  }

  it("triggers a sync attempt when the browser's online event fires", async () => {
    // Start offline so neither the on-registration drain nor the
    // queued-draft subscription fires -- this test is specifically about
    // connectivity returning, which is the only trigger left in that state.
    setOnline(false);
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);

    const client: SyncClient = { syncDraft: vi.fn().mockResolvedValue(undefined) };
    const unregister = registerSyncTriggers(client);
    expect(client.syncDraft).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    // syncPendingDrafts is fired-and-forgotten from the event handler.
    await vi.waitFor(() => {
      expect(client.syncDraft).toHaveBeenCalledTimes(1);
    });

    unregister();
    window.dispatchEvent(new Event("online"));
    expect(client.syncDraft).toHaveBeenCalledTimes(1);
  });

  it("drains a draft left queued by an earlier session as soon as triggers are registered", async () => {
    setOnline(true);
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);

    const client: SyncClient = { syncDraft: vi.fn().mockResolvedValue(undefined) };
    const unregister = registerSyncTriggers(client);

    await vi.waitFor(() => {
      expect(client.syncDraft).toHaveBeenCalledTimes(1);
    });
    expect(useIntakeStore.getState().drafts.find((d) => d.id === draft.id)?.status).toBe("synced");
    unregister();
  });

  it("syncs a draft queued while already online, with no online event ever firing", async () => {
    // The regression this guards: `online` only fires on an
    // offline->online transition, so a worker who never lost signal used to
    // press Finish and have nothing happen at all.
    setOnline(true);
    const client: SyncClient = { syncDraft: vi.fn().mockResolvedValue(undefined) };
    const unregister = registerSyncTriggers(client);

    const draft = await useIntakeStore.getState().createDraft();
    expect(client.syncDraft).not.toHaveBeenCalled();

    await useIntakeStore.getState().queueForSync(draft.id);

    await vi.waitFor(() => {
      expect(client.syncDraft).toHaveBeenCalledTimes(1);
    });
    expect(useIntakeStore.getState().drafts.find((d) => d.id === draft.id)?.status).toBe("synced");
    unregister();
  });

  it("does not retry in a loop when a sync fails (sync_failed raises the pending count)", async () => {
    setOnline(true);
    const client: SyncClient = {
      syncDraft: vi.fn().mockRejectedValue(new Error("network unreachable")),
    };
    const unregister = registerSyncTriggers(client);

    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);

    await vi.waitFor(() => {
      expect(client.syncDraft).toHaveBeenCalledTimes(1);
    });
    // Give any re-entrant trigger a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.syncDraft).toHaveBeenCalledTimes(1);
    expect(useIntakeStore.getState().drafts.find((d) => d.id === draft.id)?.status).toBe(
      "sync_failed",
    );
    unregister();
  });

  it("does not throw when the Background Sync API is unavailable (e.g. no service worker in this test environment)", () => {
    const client: SyncClient = { syncDraft: vi.fn() };
    expect(() => registerSyncTriggers(client)).not.toThrow();
  });
});
