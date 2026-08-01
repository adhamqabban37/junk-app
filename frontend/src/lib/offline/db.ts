import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { TaxonomyItem, VehicleDraft } from "./types";

interface JunkyardDB extends DBSchema {
  vehicleDrafts: {
    key: string;
    value: VehicleDraft;
    indexes: { "by-status": string };
  };
  taxonomy: {
    key: string;
    value: TaxonomyItem;
  };
}

const DB_NAME = "junkyard-intake";
const DB_VERSION = 2;
const DRAFTS_STORE = "vehicleDrafts";
const TAXONOMY_STORE = "taxonomy";

let dbPromise: Promise<IDBPDatabase<JunkyardDB>> | null = null;

function getDb(): Promise<IDBPDatabase<JunkyardDB>> {
  dbPromise ??= openDB<JunkyardDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const drafts = db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
        drafts.createIndex("by-status", "status");
      }
      if (oldVersion < 2) {
        db.createObjectStore(TAXONOMY_STORE, { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

export async function putDraft(draft: VehicleDraft): Promise<void> {
  const db = await getDb();
  await db.put(DRAFTS_STORE, draft);
}

export async function getDraft(id: string): Promise<VehicleDraft | undefined> {
  const db = await getDb();
  return db.get(DRAFTS_STORE, id);
}

export async function listDrafts(): Promise<VehicleDraft[]> {
  const db = await getDb();
  return db.getAll(DRAFTS_STORE);
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(DRAFTS_STORE, id);
}

/** Replaces the whole cached taxonomy list — it's small, static reference data refreshed wholesale, not incrementally. */
export async function putTaxonomy(items: TaxonomyItem[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(TAXONOMY_STORE, "readwrite");
  await tx.store.clear();
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

export async function getCachedTaxonomy(): Promise<TaxonomyItem[]> {
  const db = await getDb();
  return db.getAll(TAXONOMY_STORE);
}

/**
 * Test-only: closes the current connection and forces the next call to open
 * a fresh one. Must close the underlying connection (not just drop the
 * promise reference) — indexedDB.deleteDatabase() blocks forever waiting
 * for open connections to close, which is exactly what a test's afterEach
 * does next.
 */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
}
