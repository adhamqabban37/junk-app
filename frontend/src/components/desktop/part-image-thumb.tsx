"use client";

import { useEffect, useState } from "react";
import { fetchPartImageBlob } from "@/lib/api/parts";

/**
 * Fetches its own image as an authenticated blob (the file route is
 * JWT-guarded, so a plain <img src> can't reach it) and manages the
 * resulting object URL's lifecycle. Mirrors VehiclePhotoThumb's pattern --
 * used in the Review Queue to show "the photo AI graded this part from."
 */
export function PartImageThumb({
  token,
  partId,
  imageId,
  className = "aspect-square",
}: {
  token: string;
  partId: string;
  imageId: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchPartImageBlob(token, partId, imageId)
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
  }, [token, partId, imageId]);

  return (
    <div className={`overflow-hidden rounded-lg bg-muted ${className}`}>
      {objectUrl ? (
        // Blob object URLs aren't a fit for next/image's remote-image pipeline
        // -- a plain <img> is the documented approach here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={objectUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">…</span>
      )}
    </div>
  );
}
