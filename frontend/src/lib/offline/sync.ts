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

/**
 * Wires up automatic retry when connectivity returns. The `online` event
 * listener is the primary, universally-supported mechanism. Background Sync
 * API registration is attempted best-effort on top of it — it isn't
 * supported everywhere (e.g. Safari) and needs an installed service worker,
 * so failure here is silently non-fatal. The actual service worker file and
 * full Workbox caching strategy are Phase 7 scope (see docs/PROGRESS.md);
 * this only registers the sync tag if a worker already happens to be ready.
 */
export function registerSyncTriggers(client: SyncClient): () => void {
  const handleOnline = () => {
    void syncPendingDrafts(client);
  };
  window.addEventListener("online", handleOnline);

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
      // Unsupported or unavailable in this environment — the online
      // listener above already covers the acceptance-critical path.
    }
  })();

  return () => window.removeEventListener("online", handleOnline);
}
