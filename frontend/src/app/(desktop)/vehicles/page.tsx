"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/lib/auth-session";
import { listVehicles, type CrushStatus, type VehicleListItem } from "@/lib/api/vehicles";

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
        <div className="grid gap-3">
          {items.map((vehicle) => (
            // Links to the detail screen, where a manager can add missing
            // photos and get the part re-graded.
            <Link
              key={vehicle.id}
              href={`/vehicles/${vehicle.id}`}
              data-testid={`vehicle-row-${vehicle.id}`}
              className="rounded-xl border border-border p-4 transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{vehicleTitle(vehicle)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{vehicle.vin}</p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="capitalize">{vehicle.crushStatus}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{vehicle.partsCount}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
