"use client";

import { useEffect, useState } from "react";
import { fetchVehiclePhotoBlob } from "@/lib/api/vehicle-photos";

/**
 * Fetches its own photo as an authenticated blob (the file route is
 * JWT-guarded, so a plain <img src> can't reach it) and manages the
 * resulting object URL's lifecycle. Shared between the vehicles list (one
 * plain, unselectable thumbnail per card) and the vehicle detail screen's
 * photo-select-to-assign grid (selectable).
 */
export function VehiclePhotoThumb({
  token,
  vehicleId,
  photoId,
  selected,
  onToggle,
  className = "aspect-square",
}: {
  token: string;
  vehicleId: string;
  photoId: string;
  selected?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchVehiclePhotoBlob(token, vehicleId, photoId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        // Thumbnail just stays a placeholder -- not worth a page-level error.
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, vehicleId, photoId]);

  const image = objectUrl ? (
    // Blob object URLs aren't a fit for next/image's remote-image pipeline
    // -- a plain <img> is the documented approach here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={objectUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
      …
    </span>
  );

  if (!onToggle) {
    return <div className={`overflow-hidden rounded-lg ${className}`}>{image}</div>;
  }

  return (
    <button
      type="button"
      data-testid={`unassigned-photo-${photoId}`}
      aria-pressed={selected}
      onClick={onToggle}
      className={`overflow-hidden rounded-lg border-2 ${className} ${
        selected ? "border-primary ring-2 ring-primary/30" : "border-border"
      }`}
    >
      {image}
    </button>
  );
}
