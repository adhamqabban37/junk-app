"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useIntakeStore } from "@/lib/offline/store";
import type { VehicleDraft } from "@/lib/offline/types";

const IN_PROGRESS_STATUSES = new Set(["draft", "queued", "syncing", "sync_failed"]);

function nextStepFor(draft: VehicleDraft): string {
  if (!draft.vin) {
    return `/intake/${draft.id}/vin`;
  }
  return `/intake/${draft.id}/parts`;
}

function draftLabel(draft: VehicleDraft): string {
  return draft.vin ?? "VIN not yet entered";
}

export default function HomePage() {
  const router = useRouter();
  const drafts = useIntakeStore((s) => s.drafts);
  const hydrate = useIntakeStore((s) => s.hydrate);
  const createDraft = useIntakeStore((s) => s.createDraft);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const inProgress = drafts.filter((d) => IN_PROGRESS_STATUSES.has(d.status));

  async function handleNewVehicle() {
    const draft = await createDraft();
    router.push(nextStepFor(draft));
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vehicles</h1>
        <Button onClick={() => void handleNewVehicle()}>New Vehicle</Button>
      </div>

      {inProgress.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="font-medium">No vehicles in progress</p>
          <p className="text-sm text-muted-foreground">
            Tap &ldquo;New Vehicle&rdquo; to start an intake.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {inProgress.map((draft) => (
            <Button
              key={draft.id}
              variant="outline"
              className="h-auto justify-between py-3"
              onClick={() => router.push(nextStepFor(draft))}
            >
              <span>{draftLabel(draft)}</span>
              <span className="text-xs text-muted-foreground">{draft.status}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
