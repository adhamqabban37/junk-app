import { create } from "zustand";
import { randomId } from "../random-id";
import { deleteDraft, listDrafts, putDraft } from "./db";
import type { DetectionMergePlan } from "./detections";
import type {
  DraftPhoto,
  PartDetectionResult,
  PartDraft,
  VehicleDraft,
  VehicleImageAngle,
  VinEntryMethod,
} from "./types";

interface IntakeState {
  drafts: VehicleDraft[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createDraft: () => Promise<VehicleDraft>;
  setVin: (draftId: string, vin: string, method: VinEntryMethod) => Promise<void>;
  setDecoded: (draftId: string, decoded: VehicleDraft["decoded"]) => Promise<void>;
  addExteriorPhoto: (draftId: string, photo: DraftPhoto) => Promise<void>;
  /** Bulk add — one persist for the whole batch, see the implementation. */
  addExteriorPhotos: (draftId: string, photos: DraftPhoto[]) => Promise<void>;
  setExteriorPhotoAngle: (
    draftId: string,
    photoId: string,
    angle: VehicleImageAngle,
  ) => Promise<void>;
  removeExteriorPhoto: (draftId: string, photoId: string) => Promise<void>;
  addPart: (draftId: string, part: PartDraft) => Promise<void>;
  removePart: (draftId: string, partId: string) => Promise<void>;
  addPartPhoto: (draftId: string, partId: string, photo: DraftPhoto) => Promise<void>;
  applyDetectionPlan: (draftId: string, plan: DetectionMergePlan) => Promise<void>;
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
        id: randomId(),
        vin: null,
        vinEntryMethod: null,
        decoded: null,
        exteriorPhotos: [],
        parts: [],
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

    addExteriorPhoto: async (draftId, photo) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, exteriorPhotos: [...draft.exteriorPhotos, photo] });
    },

    addExteriorPhotos: async (draftId, photos) => {
      // One persist for the whole batch, not one per photo. Adding eight
      // photos through addExteriorPhoto() in a loop would read a stale
      // `draft` from the closure on every iteration after the first and
      // write back a list missing the ones before it.
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, exteriorPhotos: [...draft.exteriorPhotos, ...photos] });
    },

    setExteriorPhotoAngle: async (draftId, photoId, angle) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({
        ...draft,
        exteriorPhotos: draft.exteriorPhotos.map((p) =>
          p.id === photoId ? { ...p, angle } : p,
        ),
      });
    },

    removeExteriorPhoto: async (draftId, photoId) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({
        ...draft,
        exteriorPhotos: draft.exteriorPhotos.filter((p) => p.id !== photoId),
      });
    },

    removePart: async (draftId, partId) => {
      // A part is created the instant it is picked, so a mis-tap used to be
      // permanent: it had no photo, no way to be deleted, and the Finish
      // gate refuses to ship a photo-less part -- which left the whole
      // draft unshippable. Long-standing P1 in docs/PROGRESS.md.
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({
        ...draft,
        parts: draft.parts.filter((p) => p.id !== partId),
      });
    },

    addPart: async (draftId, part) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      await persist({ ...draft, parts: [...draft.parts, part] });
    },

    addPartPhoto: async (draftId, partId, photo) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      const parts = draft.parts.map((p) =>
        p.id === partId ? { ...p, photos: [...p.photos, photo] } : p,
      );
      await persist({ ...draft, parts });
    },

    /**
     * Applies a whole bulk-detection confirmation in ONE write.
     *
     * Doing it as a loop of addPart/addPartPhoto instead would persist the
     * entire draft -- photo blobs and all -- once per accepted detection,
     * and a confirmation of 20+ parts is completely normal here. It would
     * also leave the draft half-updated if the app were killed midway.
     */
    applyDetectionPlan: async (draftId, plan) => {
      const draft = findDraftOrThrow(get().drafts, draftId);
      const additions = new Map<
        string,
        { photos: DraftPhoto[]; detections: PartDetectionResult[] }
      >();
      for (const { partId, photo, detection } of plan.photosForExistingParts) {
        const entry = additions.get(partId) ?? { photos: [], detections: [] };
        entry.photos.push(photo);
        entry.detections.push(detection);
        additions.set(partId, entry);
      }
      const parts = draft.parts.map((part) => {
        const extra = additions.get(part.id);
        if (!extra) return part;
        return {
          ...part,
          photos: [...part.photos, ...extra.photos],
          // A hand-added part can now carry scan grades for the photos the
          // scan contributed, while its own hand-shot photos stay
          // detection-free and get graded server-side as usual.
          detections: [...(part.detections ?? []), ...extra.detections],
        };
      });
      await persist({ ...draft, parts: [...parts, ...plan.newParts] });
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
