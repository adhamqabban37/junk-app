import { create } from "zustand";
import { fetchTaxonomy as apiFetchTaxonomy } from "../api";
import { getCachedTaxonomy, putTaxonomy } from "./db";
import type { TaxonomyItem } from "./types";

interface TaxonomyState {
  items: TaxonomyItem[];
  hydrated: boolean;
  /** Loads whatever was last cached in IndexedDB — instant, works offline. */
  hydrate: () => Promise<void>;
  /** Best-effort network refresh; failure (e.g. offline) leaves the cached/hydrated list untouched rather than clearing it. */
  refresh: (token: string, fetchImpl?: typeof apiFetchTaxonomy) => Promise<void>;
}

export const useTaxonomyStore = create<TaxonomyState>((set) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    const items = await getCachedTaxonomy();
    set({ items, hydrated: true });
  },

  refresh: async (token, fetchImpl = apiFetchTaxonomy) => {
    try {
      const items = await fetchImpl(token);
      await putTaxonomy(items);
      set({ items, hydrated: true });
    } catch {
      // Offline or the request otherwise failed — whatever's already
      // hydrated/cached from a previous session stays as-is, since precached
      // taxonomy existing at all is the point of this store.
    }
  },
}));
