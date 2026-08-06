"use client";

import { useEffect, useState } from "react";
import { fetchPartImageObjectUrl } from "@/lib/api/parts";

export function PartPhoto({
  token,
  partId,
  imageId,
}: {
  token: string;
  partId: string;
  imageId: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // No reset of error/objectUrl here: the parent always keys this
    // component by imageId (see InventoryPage), so a new photo means a
    // fresh mount with fresh initial state, not a prop change on the same
    // instance -- resetting state synchronously in the effect body would
    // trip react-hooks/set-state-in-effect for no real benefit.
    let cancelled = false;
    let currentUrl: string | null = null;
    fetchPartImageObjectUrl(token, partId, imageId)
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
  }, [token, partId, imageId]);

  if (error) {
    return (
      <div
        role="alert"
        className="flex h-24 w-24 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-xs text-destructive"
      >
        Failed to load
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="h-24 w-24 animate-pulse rounded-lg border border-border bg-muted" />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch, not a static/remote asset next/image can optimize
  return <img src={objectUrl} alt="Part photo" className="h-24 w-24 rounded-lg border border-border object-cover" />;
}
