import { create } from "zustand";
import { randomUUID } from "@/lib/uuid";
import { deleteDraft, listDrafts, putDraft } from "./db";
import type { DraftPhoto, VehicleDraft, VinEntryMethod } from "./types";

interface IntakeState {
  drafts: VehicleDraft[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createDraft: () => Promise<VehicleDraft>;
  setVin: (draftId: string, vin: string, method: VinEntryMethod) => Promise<void>;
  setDecoded: (draftId: string, decoded: VehicleDraft["decoded"]) => Promise<void>;
  addPhoto: (draftId: string, photo: DraftPhoto) => Promise<void>;
  queueForSync: (draftId: string) => Promise<void>;
  markSyncing: (draftId: string) => Promise<void>;
  markSynced: (draftId: string) => Promise<void>;
  markSyncFailed: (draftId: string, error: string) => Promise<void>;
  removeDraft: (draftId: string) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function findDraftOrThrow(drafts: VehicleDraft[], id: string): VehicleDraft {
  const draft = drafts.find((d) => d.id === id);
  if (!draft) {
    throw new Error(`Unknown draft: ${id}`);
  }
  return draft;
}

export const useIntakeStore = create<IntakeState>((set, get) => {
  async function persist(draft: VehicleDraft): Promise<void> {
    const updated: VehicleDraft = { ...draft, updatedAt: nowIso() };
    await putDraft(updated);
    set((state) => ({
      drafts: state.drafts.some((d) => d.id === updated.id)
        ? state.drafts.map((d) => (d.id === updated.id ? updated : d))
        : [...state.drafts, updated],
    }));
  }

  return {
    drafts: [],
    hydrated: false,

    hydrate: async () => {
      const drafts = await listDrafts();
      set({ drafts, hydrated: true });
    },

    // A UUID generated on-device, before any network round-trip, is what
    // lets the server dedup a draft that gets re-queued after the app is
    // killed and relaunched mid-sync (Phase 3 planning-gate finding).
    createDraft: async () => {
      const draft: VehicleDraft = {
        id: randomUUID(),
        vin: null,
        vinEntryMethod: null,
        decoded: null,
        photos: [],
        status: "draft",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await putDraft(draft);
      set((state) => ({ drafts: [...state.drafts, draft] }));
      return draft;
    },

    setVin: async (draftId, vin, method) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, vin, vinEntryMethod: method });
    },

    setDecoded: async (draftId, decoded) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, decoded });
    },

    addPhoto: async (draftId, photo) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, photos: [...draft.photos, photo] });
    },

    queueForSync: async (draftId) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, status: "queued", syncError: undefined });
    },

    markSyncing: async (draftId) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, status: "syncing" });
    },

    markSynced: async (draftId) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, status: "synced" });
    },

    markSyncFailed: async (draftId, error) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, status: "sync_failed", syncError: error });
    },

    removeDraft: async (draftId) => {
      await deleteDraft(draftId);
      set((state) => ({ drafts: state.drafts.filter((d) => d.id !== draftId) }));
    },
  };
});
