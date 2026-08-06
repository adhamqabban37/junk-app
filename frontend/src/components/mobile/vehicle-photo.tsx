"use client";

import { useEffect, useState } from "react";
import { fetchVehicleImageObjectUrl } from "@/lib/api/vehicles";

/**
 * Always key this by imageId at the call site -- it reads props once on
 * mount and does not reset state on a prop change (that would trip
 * react-hooks/set-state-in-effect for no benefit, see PartPhoto).
 */
export function VehiclePhoto({
  token,
  vehicleId,
  imageId,
  angle,
}: {
  token: string;
  vehicleId: string;
  imageId: string;
  angle: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;
    fetchVehicleImageObjectUrl(token, vehicleId, imageId)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [token, vehicleId, imageId]);

  return (
    <figure className="flex flex-col items-center gap-1">
      {error ? (
        <div
          role="alert"
          className="flex h-20 w-20 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive"
        >
          Failed
        </div>
      ) : !objectUrl ? (
        <div className="h-20 w-20 animate-pulse rounded-lg border border-border bg-muted" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch, not an asset next/image can optimize
        <img
          src={objectUrl}
          alt={`${angle} exterior photo`}
          className="h-20 w-20 rounded-lg border border-border object-cover"
        />
      )}
      <figcaption className="text-xs capitalize text-muted-foreground">{angle}</figcaption>
    </figure>
  );
}
