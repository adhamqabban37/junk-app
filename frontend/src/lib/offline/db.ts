import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { VehicleDraft } from "./types";

interface JunkyardDB extends DBSchema {
  vehicleDrafts: {
    key: string;
    value: VehicleDraft;
    indexes: { "by-status": string };
  };
}

const DB_NAME = "junkyard-intake";
const DB_VERSION = 1;
const STORE = "vehicleDrafts";

let dbPromise: Promise<IDBPDatabase<JunkyardDB>> | null = null;

function getDb(): Promise<IDBPDatabase<JunkyardDB>> {
  dbPromise ??= openDB<JunkyardDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("by-status", "status");
    },
  });
  return dbPromise;
}

export async function putDraft(draft: VehicleDraft): Promise<void> {
  const db = await getDb();
  await db.put(STORE, draft);
}

export async function getDraft(id: string): Promise<VehicleDraft | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function listDrafts(): Promise<VehicleDraft[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
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
