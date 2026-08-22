"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { listMyVehicles, type MyVehicleListItem } from "@/lib/api/vehicles";
import { useIntakeStore } from "@/lib/offline/store";
import type { VehicleDraft } from "@/lib/offline/types";

const IN_PROGRESS_STATUSES = new Set(["draft", "queued", "syncing", "sync_failed"]);

function nextStepFor(draft: VehicleDraft): string {
  if (!draft.vin) {
    return `/intake/${draft.id}/vin`;
  }
  return `/intake/${draft.id}/vehicle`;
}

function draftLabel(draft: VehicleDraft): string {
  return draft.vin ?? "VIN not yet entered";
}

function sentVehicleTitle(vehicle: MyVehicleListItem): string {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.vin;
}

/** The worker's own previously-sent vehicles -- separate from the offline
 * in-progress drafts above, this is a live server list (GET /vehicles/mine)
 * so it only loads once a session token exists. */
function SentVehiclesSection() {
  const router = useRouter();
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<MyVehicleListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listMyVehicles(token, { pageSize: 25 })
      .then((res) => {
        if (cancelled) return;
        setError(false);
        setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  // No token yet is not this component's problem to show a loading state
  // for -- (mobile)/layout.tsx's auth guard already renders nothing at all
  // until a session exists, so in practice this only matters in isolation
  // (e.g. tests rendering HomePage directly, unauthenticated).
  if (!token) {
    return null;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <span>Couldn&apos;t load your sent vehicles.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Your sent vehicles</h2>
      <div className="grid gap-2">
        {items.map((vehicle) => (
          <Button
            key={vehicle.id}
            variant="outline"
            className="h-auto flex-col items-start gap-0.5 py-3"
            onClick={() => router.push(`/my-vehicles/${vehicle.id}`)}
          >
            <div className="flex w-full items-center justify-between">
              <span>{sentVehicleTitle(vehicle)}</span>
              <span className="text-xs text-muted-foreground">{vehicle.vin}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {vehicle.partsCount} part{vehicle.partsCount === 1 ? "" : "s"} ·{" "}
              {vehicle.unassignedPhotosCount} photo{vehicle.unassignedPhotosCount === 1 ? "" : "s"} waiting on a
              manager
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
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
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
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

      <SentVehiclesSection />
    </div>
  );
}
