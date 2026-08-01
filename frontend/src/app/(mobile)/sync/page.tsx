"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiBaseUrl } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { useIntakeStore } from "@/lib/offline/store";
import { createFetchSyncClient, syncPendingDrafts } from "@/lib/offline/sync";
import type { VehicleDraft } from "@/lib/offline/types";

const PENDING_STATUSES = new Set(["queued", "syncing", "sync_failed"]);

function statusLabel(draft: VehicleDraft): string {
  switch (draft.status) {
    case "queued":
      return "Waiting to sync";
    case "syncing":
      return "Syncing…";
    case "sync_failed":
      return draft.syncError ? `Failed: ${draft.syncError}` : "Sync failed";
    default:
      return draft.status;
  }
}

export default function SyncPage() {
  const drafts = useIntakeStore((s) => s.drafts);
  const hydrated = useIntakeStore((s) => s.hydrated);
  const hydrate = useIntakeStore((s) => s.hydrate);
  const token = useAuthSession((s) => s.token);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  const pending = drafts.filter((d) => PENDING_STATUSES.has(d.status));

  async function handleSyncNow() {
    if (!token) return;
    setSyncing(true);
    try {
      const client = createFetchSyncClient(apiBaseUrl(), () => token);
      await syncPendingDrafts(client);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Sync queue</h1>
        <Button onClick={() => void handleSyncNow()} disabled={syncing || pending.length === 0}>
          Sync now
        </Button>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="font-medium">Nothing to sync</p>
          <p className="text-sm text-muted-foreground">
            Vehicles you queue for sync will show up here until they finish.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {pending.map((draft) => (
            <li
              key={draft.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span>{draft.vin ?? "VIN not yet entered"}</span>
              <span
                className={
                  draft.status === "sync_failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }
              >
                {statusLabel(draft)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
