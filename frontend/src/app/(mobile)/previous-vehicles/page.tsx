"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { listVehicles, type VehicleListItem } from "@/lib/api/vehicles";

// Backend's ListVehiclesDto caps pageSize at 100. A yard's vehicle count is
// orders of magnitude below its part count, so one page is enough here --
// unlike desktop Inventory, this list is not virtualized.
const PAGE_SIZE = 100;

function vehicleLabel(v: VehicleListItem): string {
  const described = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return described || v.vin;
}

export default function MobileVehiclesPage() {
  const router = useRouter();
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<VehicleListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listVehicles(token, { pageSize: PAGE_SIZE })
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

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load vehicles.
        </p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  if (items === null) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Previous vehicles</h1>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="font-medium">No vehicles yet</p>
          <p className="text-sm text-muted-foreground">
            Vehicles show up here once an intake has synced.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {items.map((vehicle) => (
            <li key={vehicle.id}>
              <Button
                variant="outline"
                className="h-auto w-full justify-between py-3 text-left"
                onClick={() => router.push(`/previous-vehicles/${vehicle.id}`)}
              >
                <span className="flex flex-col items-start">
                  <span>{vehicleLabel(vehicle)}</span>
                  <span className="text-xs text-muted-foreground">{vehicle.vin}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {vehicle.partsCount} {vehicle.partsCount === 1 ? "part" : "parts"}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
