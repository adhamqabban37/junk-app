"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { useCamera } from "@/hooks/use-camera";
import { useAuthSession } from "@/lib/auth-session";
import { getVehicle, type VehicleDetail } from "@/lib/api/vehicles";
import {
  addVehiclePhotos,
  fetchVehiclePhotoBlob,
  listVehiclePhotos,
  VEHICLE_PHOTO_SECTIONS,
  type VehiclePhotoSection,
  type VehiclePhotoSummary,
} from "@/lib/api/vehicle-photos";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { randomUUID } from "@/lib/uuid";

interface StagedPhoto {
  id: string;
  blob: Blob;
  previewUrl: string;
}

function vehicleTitle(vehicle: VehicleDetail): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Unknown vehicle";
}

/** Same authenticated-blob-fetch pattern as the desktop vehicle detail screen's VehiclePhotoThumb -- the file route is JWT-guarded, so a plain <img src> can't reach it. */
function PhotoThumb({ token, vehicleId, photo }: { token: string; vehicleId: string; photo: VehiclePhotoSummary }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchVehiclePhotoBlob(token, vehicleId, photo.id)
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
  }, [token, vehicleId, photo.id]);

  return (
    <div className="aspect-square overflow-hidden rounded-lg border border-border">
      {objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob object URLs aren't a fit for next/image's remote-image pipeline.
        <img src={objectUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </span>
      )}
    </div>
  );
}

export default function MyVehicleDetailPageClient({ vehicleId }: { vehicleId: string }) {
  const token = useAuthSession((s) => s.token);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [photos, setPhotos] = useState<VehiclePhotoSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Captured/picked photos sit here first -- nothing is sent to the server
  // until Upload is tapped. Previously each photo uploaded the instant it
  // was picked, with no visible confirmation; the user reported it as
  // "they just disappear, nothing happens" -- this staging step plus an
  // explicit Upload button is the fix.
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  // Optional, applies to the whole batch about to be uploaded -- never
  // required, never per-photo (see VehiclePhotoSection's own doc comment).
  const [section, setSection] = useState<VehiclePhotoSection | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState<number | null>(null);

  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([getVehicle(token, vehicleId), listVehiclePhotos(token, vehicleId)])
      .then(([v, p]) => {
        if (cancelled) return;
        setError(false);
        setVehicle(v);
        setPhotos(p);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, vehicleId, attempt]);

  // Revoke every staged preview URL on unmount, not just after upload/remove
  // -- otherwise navigating away mid-staging leaks object URLs.
  useEffect(() => {
    return () => {
      for (const photo of staged) URL.revokeObjectURL(photo.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup-only effect, intentionally not re-running per staged change
  }, []);

  function addStaged(blob: Blob) {
    setUploadedCount(null);
    setStaged((prev) => [...prev, { id: randomUUID(), blob, previewUrl: URL.createObjectURL(blob) }]);
  }

  function removeStaged(id: string) {
    setStaged((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function handleCapture() {
    if (!videoRef.current) return;
    const { blob } = await captureFrame(videoRef.current);
    addStaged(blob);
  }

  async function handleFileSelected(file: File) {
    const { blob } = await captureFromFile(file);
    addStaged(blob);
  }

  async function handleUpload() {
    if (!token || staged.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const created = await addVehiclePhotos(
        token,
        vehicleId,
        staged.map((s) => ({ id: s.id, blob: s.blob })),
        section ?? undefined,
      );
      setPhotos((prev) => (prev ? [...prev, ...created] : created));
      setUploadedCount(created.length);
      for (const photo of staged) URL.revokeObjectURL(photo.previewUrl);
      setStaged([]);
      setSection(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't upload those photos, try again.");
    } finally {
      setUploading(false);
    }
  }

  if (error) {
    return (
      <div
        role="alert"
        className="m-6 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <span>Couldn&apos;t load this vehicle.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!vehicle || !photos) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{vehicleTitle(vehicle)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vehicle.vin} · {vehicle.partsCount} part{vehicle.partsCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Sent photos</h2>
          <span className="text-sm text-muted-foreground">
            {photos.length} waiting on a manager to sort into parts
          </span>
        </div>

        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <PhotoThumb key={photo.id} token={token as string} vehicleId={vehicleId} photo={photo} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No photos sent yet.</p>
        )}

        {uploadedCount !== null && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            {uploadedCount} photo{uploadedCount === 1 ? "" : "s"} uploaded.
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <h2 className="text-sm font-medium">Add photos</h2>

        {cameraReady && (
          <div className="space-y-2">
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline>
              <track kind="captions" />
            </video>
            <Button type="button" variant="outline" className="w-full" onClick={() => void handleCapture()}>
              Capture photo
            </Button>
          </div>
        )}
        {!cameraReady && cameraError && (
          <p role="alert" className="text-sm text-destructive">
            {cameraError}
          </p>
        )}
        <PhotoPicker
          inputId="add-vehicle-photo-picker"
          label="Choose photos"
          onFileSelected={(file) => void handleFileSelected(file)}
        />

        {staged.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{staged.length} photo{staged.length === 1 ? "" : "s"} ready to upload</p>
            <div className="grid grid-cols-3 gap-2">
              {staged.map((photo) => (
                <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a next/image candidate */}
                  <img src={photo.previewUrl} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => removeStaged(photo.id)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-medium text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Which area are these photos of? (optional)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {VEHICLE_PHOTO_SECTIONS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSection((prev) => (prev === s.value ? null : s.value))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      section === s.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button type="button" className="w-full" disabled={staged.length === 0 || uploading} onClick={() => void handleUpload()}>
          {uploading ? "Uploading…" : `Upload ${staged.length} photo${staged.length === 1 ? "" : "s"}`}
        </Button>

        {uploadError && (
          <p role="alert" className="text-sm text-destructive">
            {uploadError}
          </p>
        )}
      </div>
    </div>
  );
}
