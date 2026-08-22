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
  type VehiclePhotoSummary,
} from "@/lib/api/vehicle-photos";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { randomUUID } from "@/lib/uuid";

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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  async function uploadPhoto(blob: Blob) {
    if (!token) return;
    setUploading(true);
    setUploadError(null);
    try {
      const created = await addVehiclePhotos(token, vehicleId, [{ id: randomUUID(), blob }]);
      setPhotos((prev) => (prev ? [...prev, ...created] : created));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't upload that photo, try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleCapture() {
    if (!videoRef.current) return;
    const { blob } = await captureFrame(videoRef.current);
    await uploadPhoto(blob);
  }

  async function handleFileSelected(file: File) {
    const { blob } = await captureFromFile(file);
    await uploadPhoto(blob);
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
          <h2 className="text-sm font-medium">Photos</h2>
          <span className="text-sm text-muted-foreground">
            {photos.length} waiting on a manager to sort into parts
          </span>
        </div>

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo) => (
              <PhotoThumb key={photo.id} token={token as string} vehicleId={vehicleId} photo={photo} />
            ))}
          </div>
        )}

        {cameraReady && (
          <div className="space-y-2">
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline>
              <track kind="captions" />
            </video>
            <Button type="button" className="w-full" disabled={uploading} onClick={() => void handleCapture()}>
              {uploading ? "Uploading…" : "Capture more photos"}
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
          label={uploading ? "Uploading…" : "Choose more photos"}
          onFileSelected={(file) => void handleFileSelected(file)}
        />

        {uploadError && (
          <p role="alert" className="text-sm text-destructive">
            {uploadError}
          </p>
        )}
      </div>
    </div>
  );
}
