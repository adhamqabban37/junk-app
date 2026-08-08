import { useIntakeStore } from "./store";
import type { VehicleDraft } from "./types";

export interface SyncClient {
  syncDraft(draft: VehicleDraft): Promise<void>;
}

function buildIntakeFormData(draft: VehicleDraft): FormData {
  const formData = new FormData();
  formData.append("draftId", draft.id);
  formData.append("vin", draft.vin ?? "");
  formData.append("vinEntryMethod", draft.vinEntryMethod ?? "");
  formData.append("decoded", JSON.stringify(draft.decoded));
  formData.append(
    "parts",
    JSON.stringify(
      draft.parts.map((p) => ({
        id: p.id,
        taxonomyId: p.taxonomyId,
        taxonomyName: p.taxonomyName,
        photoIds: p.photos.map((photo) => photo.id),
        // Grades the bulk scan already produced. The server persists these
        // rather than re-grading the photo, because a scene photo re-graded
        // with the single-part prompt would stamp one arbitrary grade onto
        // every part in it. Absent for hand-shot photos, which still get
        // graded server-side.
        detections: p.detections ?? [],
      })),
    ),
  );
  for (const photo of draft.exteriorPhotos) {
    formData.append(`exteriorPhoto:${photo.angle ?? "unknown"}:${photo.id}`, photo.blob, `${photo.id}.jpg`);
  }
  for (const part of draft.parts) {
    for (const photo of part.photos) {
      formData.append(`partPhoto:${part.id}:${photo.id}`, photo.blob, `${photo.id}.jpg`);
    }
  }
  return formData;
}

export function createFetchSyncClient(apiBaseUrl: string, getAuthToken: () => string | null): SyncClient {
  return {
    async syncDraft(draft) {
      const token = getAuthToken();
      const response = await fetch(`${apiBaseUrl}/vehicles/intake`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: buildIntakeFormData(draft),
      });
      if (!response.ok) {
        throw new Error(`Sync failed with status ${response.status}`);
      }
    },
  };
}

/**
 * Syncs every queued/previously-failed draft. A single draft failing never
 * aborts the batch or throws out of this function — a yard worker's queue
 * must keep draining even if one record's sync errors, and the failure is
 * recorded on the draft itself (visible in the Sync Queue Manager) rather
 * than lost.
 */
export async function syncPendingDrafts(client: SyncClient): Promise<void> {
  const store = useIntakeStore.getState();
  const pending = store.drafts.filter((d) => d.status === "queued" || d.status === "sync_failed");

  for (const draft of pending) {
    await store.markSyncing(draft.id);
    try {
      await client.syncDraft(draft);
      await store.markSynced(draft.id);
    } catch (err) {
      await store.markSyncFailed(draft.id, err instanceof Error ? err.message : "Unknown sync error");
    }
  }
}

function pendingCount(state: { drafts: VehicleDraft[] }): number {
  return state.drafts.filter((d) => d.status === "queued" || d.status === "sync_failed").length;
}

/**
 * Wires up every trigger that should drain the pending-draft queue.
 *
 * The `online` event alone is not enough, and shipping only that was a real
 * bug: it fires on an offline->online *transition*, so a worker with an
 * uninterrupted connection could press "Finish & queue for sync" and have
 * the draft sit in IndexedDB forever, with the app looking like the button
 * did nothing. The offline path (the one the Phase 3 acceptance criteria
 * exercised) worked fine, which is exactly why it went unnoticed. Hence
 * three triggers:
 *
 *  1. On registration — a draft queued in an earlier session/app launch.
 *     Also covers the store hydrating from IndexedDB after this runs, via
 *     the subscription below.
 *  2. When a draft *becomes* pending — the "worker just pressed Finish
 *     while online" case, where no `online` event will ever fire.
 *  3. On `online` — connectivity actually returning, the original case.
 *
 * Background Sync API registration is attempted best-effort on top — it
 * isn't supported everywhere (e.g. Safari) and needs an installed service
 * worker, so failure is silently non-fatal. `registerServiceWorker()`
 * (`lib/pwa.ts`, called from `(mobile)/layout.tsx`) must have already run
 * for `navigator.serviceWorker.ready` to resolve at all.
 */
export function registerSyncTriggers(client: SyncClient): () => void {
  // syncPendingDrafts() writes back to the store on every draft it touches
  // (markSyncing/markSynced/markSyncFailed), which re-enters the
  // subscription below. This flag is what stops that from recursing --
  // notably, a draft going to sync_failed *raises* the pending count, so
  // without it a failing sync would re-trigger itself indefinitely.
  let draining = false;

  async function drain(): Promise<void> {
    if (draining) return;
    // navigator.onLine's true value is unreliable (it only proves a local
    // link, not reachability), but its false value is trustworthy enough to
    // skip work we know will fail -- the online listener will pick it up.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    draining = true;
    try {
      await syncPendingDrafts(client);
    } finally {
      draining = false;
    }
  }

  const handleOnline = () => {
    void drain();
  };
  window.addEventListener("online", handleOnline);

  const unsubscribe = useIntakeStore.subscribe((state, prev) => {
    if (pendingCount(state) > pendingCount(prev)) {
      void drain();
    }
  });

  void drain();

  void (async () => {
    try {
      if (!("serviceWorker" in navigator) || !("SyncManager" in window)) {
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const syncCapable = registration as ServiceWorkerRegistration & {
        sync: { register(tag: string): Promise<void> };
      };
      await syncCapable.sync.register("sync-drafts");
    } catch {
      // Unsupported or unavailable in this environment — the triggers
      // above already cover the acceptance-critical paths.
    }
  })();

  return () => {
    window.removeEventListener("online", handleOnline);
    unsubscribe();
  };
}
