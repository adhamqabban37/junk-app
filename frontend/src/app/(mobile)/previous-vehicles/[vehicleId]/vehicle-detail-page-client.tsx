"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { VehiclePhoto } from "@/components/mobile/vehicle-photo";
import { captureFromFile } from "@/lib/offline/capture";
import { useAuthSession } from "@/lib/auth-session";
import {
  addPartImage,
  addVehicleImage,
  getVehicle,
  type VehicleDetail,
} from "@/lib/api/vehicles";

const ANGLES = ["front", "rear", "left", "right"] as const;

export default function VehicleDetailPageClient({ vehicleId }: { vehicleId: string }) {
  const token = useAuthSession((s) => s.token);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Which target is mid-upload: `exterior:{angle}` or `part:{partId}`.
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [addingAngle, setAddingAngle] = useState<string | null>(null);
  const [addingPartId, setAddingPartId] = useState<string | null>(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getVehicle(token, vehicleId)
      .then((detail) => {
        if (cancelled) return;
        setError(false);
        setVehicle(detail);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, vehicleId, attempt]);

  // Photos added here upload straight to the server rather than going
  // through the IndexedDB draft queue: the vehicle already exists
  // server-side, so there is no draft to attach them to. That does mean this
  // screen needs a connection, unlike the intake flow.
  async function handleExteriorFile(angle: string, file: File) {
    if (!token) return;
    setUploading(`exterior:${angle}`);
    setUploadError(null);
    try {
      const { blob } = await captureFromFile(file);
      await addVehicleImage(token, vehicleId, angle, blob);
      setAddingAngle(null);
      reload();
    } catch {
      setUploadError("Couldn't upload that photo. Check your connection and try again.");
    } finally {
      setUploading(null);
    }
  }

  async function handlePartFile(partId: string, file: File) {
    if (!token) return;
    setUploading(`part:${partId}`);
    setUploadError(null);
    try {
      const { blob } = await captureFromFile(file);
      await addPartImage(token, partId, blob);
      setAddingPartId(null);
      reload();
    } catch {
      setUploadError("Couldn't upload that photo. Check your connection and try again.");
    } finally {
      setUploading(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load this vehicle.
        </p>
        <Button variant="outline" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  if (!vehicle) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const described = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{described || vehicle.vin}</h1>
        <p className="text-sm text-muted-foreground">{vehicle.vin}</p>
      </div>

      {uploadError && (
        <p role="alert" className="text-sm text-destructive">
          {uploadError}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Exterior photos</h2>
        {vehicle.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">No exterior photos yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {vehicle.images.map((image) => (
              <VehiclePhoto
                key={image.id}
                token={token!}
                vehicleId={vehicle.id}
                imageId={image.id}
                angle={image.angle}
              />
            ))}
          </div>
        )}

        {addingAngle === null ? (
          <div className="flex flex-wrap gap-2">
            {ANGLES.map((angle) => (
              <Button
                key={angle}
                variant="secondary"
                className="capitalize"
                onClick={() => {
                  setUploadError(null);
                  setAddingAngle(angle);
                }}
              >
                Add {angle}
              </Button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium capitalize">Add {addingAngle} photo</p>
            <PhotoPicker
              inputId={`vehicle-photo-${addingAngle}`}
              label={uploading === `exterior:${addingAngle}` ? "Uploading…" : "Choose photo"}
              onFileSelected={(file) => void handleExteriorFile(addingAngle, file)}
            />
            <Button variant="outline" className="w-full" onClick={() => setAddingAngle(null)}>
              Cancel
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Parts</h2>
        {vehicle.parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts on this vehicle.</p>
        ) : (
          <ul className="grid gap-2">
            {vehicle.parts.map((part) => (
              <li key={part.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="text-sm">{part.taxonomyName ?? "Part"}</span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {part.status.replace(/_/g, " ")} · {part.photosCount}{" "}
                      {part.photosCount === 1 ? "photo" : "photos"}
                    </span>
                  </span>
                  {addingPartId !== part.id && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setUploadError(null);
                        setAddingPartId(part.id);
                      }}
                    >
                      Add photo
                    </Button>
                  )}
                </div>
                {addingPartId === part.id && (
                  <div className="mt-3 space-y-2">
                    <PhotoPicker
                      inputId={`part-photo-${part.id}`}
                      label={uploading === `part:${part.id}` ? "Uploading…" : "Choose photo"}
                      onFileSelected={(file) => void handlePartFile(part.id, file)}
                    />
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setAddingPartId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
