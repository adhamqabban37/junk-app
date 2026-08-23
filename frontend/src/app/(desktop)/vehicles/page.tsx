"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/lib/auth-session";
import { listVehicles, type CrushStatus, type VehicleListItem } from "@/lib/api/vehicles";
import { VehiclePhotoThumb } from "@/components/desktop/vehicle-photo-thumb";
import { GradeBadge } from "@/components/desktop/grade-badge";

const CRUSH_STATUS_OPTIONS: { value: CrushStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "stripped", label: "Stripped" },
  { value: "crushed", label: "Crushed" },
];

function vehicleTitle(vehicle: VehicleListItem): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Unknown vehicle";
}

export default function VehiclesPage() {
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<VehicleListItem[] | null>(null);
  const [crushStatus, setCrushStatus] = useState<CrushStatus | "">("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // Backend's ListVehiclesDto caps pageSize at 100 -- requesting more 400s
    // every call (found via a live browser walkthrough; the unit test mocks
    // listVehicles directly, so it never exercised the real DTO validation).
    listVehicles(token, { crushStatus: crushStatus || undefined, pageSize: 100 })
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
  }, [token, crushStatus, attempt]);

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load vehicles.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Vehicles</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="vehicle-crush-status" className="text-sm font-medium text-muted-foreground">
            Crush status
          </label>
          <select
            id="vehicle-crush-status"
            value={crushStatus}
            onChange={(e) => setCrushStatus(e.target.value as CrushStatus | "")}
            className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
          >
            {CRUSH_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="font-medium">No vehicles in the yard</p>
          <p className="text-sm text-muted-foreground">
            Vehicles show up here once intake decodes a VIN from the mobile app.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((vehicle) => (
            <Link
              key={vehicle.id}
              href={`/vehicles/${vehicle.id}`}
              data-testid={`vehicle-row-${vehicle.id}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-border transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              {vehicle.firstPhotoId ? (
                <VehiclePhotoThumb
                  token={token as string}
                  vehicleId={vehicle.id}
                  photoId={vehicle.firstPhotoId}
                  className="aspect-[4/3] rounded-none"
                />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-muted text-xs text-muted-foreground">
                  No photo yet
                </div>
              )}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div>
                  <p className="font-medium leading-tight">{vehicleTitle(vehicle)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{vehicle.vin}</p>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <GradeBadge grade={vehicle.latestGrade} />
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {vehicle.partsCount} part{vehicle.partsCount === 1 ? "" : "s"}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                    {vehicle.crushStatus}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
