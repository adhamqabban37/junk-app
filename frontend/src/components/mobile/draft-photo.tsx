"use client";

import { useEffect, useMemo } from "react";

/**
 * Thumbnail for a photo that is still only in the IndexedDB draft.
 *
 * Sibling to VehiclePhoto, which fetches an already-uploaded image from the
 * API. This one renders a local Blob, so it needs no token and works
 * offline -- which matters, because the exterior step it serves is the part
 * of intake that has to keep working with no connection.
 *
 * The object URL is revoked on unmount and whenever the blob changes.
 * Without that, a worker re-picking photos a few times leaks a full-size
 * image per render into the tab for as long as it stays open, which on a
 * phone is a real memory problem rather than a tidiness one.
 */
export function DraftPhotoView({
  blob,
  alt,
  className = "h-24 w-24",
}: {
  blob: Blob;
  alt: string;
  className?: string;
}) {
  // Derived during render rather than set from an effect. The effect-plus-
  // state version needs a null first paint (so the thumbnail visibly pops
  // in) and trips react-hooks/set-state-in-effect. A local Blob needs no
  // await, so there is nothing to wait for -- the url exists immediately and
  // the effect is left doing only what it is actually for: cleanup.
  const objectUrl = useMemo(() => URL.createObjectURL(blob), [blob]);

  useEffect(() => {
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- object URL for a local Blob, nothing next/image can optimize
    <img
      src={objectUrl}
      alt={alt}
      className={`${className} rounded-lg border border-border object-cover`}
    />
  );
}
