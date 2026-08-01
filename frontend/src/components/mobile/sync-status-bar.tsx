"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useIntakeStore } from "@/lib/offline/store";

const PENDING_STATUSES = new Set(["queued", "syncing", "sync_failed"]);

function subscribeOnlineStatus(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

// Assume online for the server-rendered/pre-hydration snapshot; corrected
// on the client the instant React reconciles the real value post-hydration.
function getServerOnlineSnapshot(): boolean {
  return true;
}

export function SyncStatusBar() {
  const drafts = useIntakeStore((s) => s.drafts);
  const hydrate = useIntakeStore((s) => s.hydrate);
  const online = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const pendingCount = drafts.filter((d) => PENDING_STATUSES.has(d.status)).length;

  return (
    <Link
      href="/sync"
      className="flex items-center justify-between border-t border-border px-4 py-3 text-sm"
    >
      <span className={online ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
        {online ? "Online" : "Offline"}
      </span>
      <span className="text-muted-foreground">
        {pendingCount === 0 ? "All synced" : `${pendingCount} pending`}
      </span>
    </Link>
  );
}
