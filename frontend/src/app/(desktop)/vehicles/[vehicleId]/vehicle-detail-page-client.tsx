"use client";

import Link from "next/link";
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
  scanVehicle,
  type VehicleDetail,
  type VehicleScanSummary,
} from "@/lib/api/vehicles";

const ANGLES = ["front", "rear", "left", "right"] as const;

const CLARITY_LABEL: Record<string, string> = {
  clear: "Clear",
  partial: "Partly usable",
  poor: "Hard to read",
  unknown: "Not assessed",
};

/**
 * Manager-side counterpart to the worker's /previous-vehicles/[vehicleId]
 * screen. Same three API calls, deliberately a different screen rather than
 * a shared one: the two answer different questions. The worker is standing
 * at the car deciding what to re-shoot; the manager is at a desk finding
 * which parts are stuck ungradeable and can't be reviewed.
 *
 * PhotoPicker/VehiclePhoto live under components/mobile/ but are not
 * mobile-specific -- reused here rather than duplicated. Worth moving up a
 * level if a third caller appears.
 *
 * Needs a connection: like the worker screen, these uploads go straight to
 * the server instead of through the IndexedDB draft queue, because the
 * vehicle already exists server-side and there is no draft to attach them
 * to. That's fine for a desk, unlike the yard.
 */
export default function ManagerVehicleDetailPageClient({
  vehicleId,
}: {
  vehicleId: string;
}) {
  const token = useAuthSession((s) => s.token);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Which target is mid-upload: `exterior:{angle}` or `part:{partId}`.
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [addingAngle, setAddingAngle] = useState<string | null>(null);
  const [addingPartId, setAddingPartId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<VehicleScanSummary | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * The AI pass. Either re-reads the vehicle's stored walkaround photos or
   * analyses newly-picked ones; both identify every visible part, grade it,
   * and file it. Takes 20-40s, hence the explicit scanning state rather
   * than a spinner-less await.
   */
  async function runScan(options: { blobs?: Blob[]; useExistingImages?: boolean }) {
    if (!token || scanning) return;
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const summary = await scanVehicle(token, vehicleId, options);
      setScanResult(summary);
      reload();
    } catch {
      setScanError(
        "Couldn't scan those photos. The AI needs a connection — check it and try again.",
      );
    } finally {
      setScanning(false);
    }
  }

  async function handleScanFiles(files: File[]) {
    // Same canvas pipeline as every other upload path, so scanned photos
    // get consistent JPEG encoding regardless of what the browser handed us.
    const captured = await Promise.all(files.map((file) => captureFromFile(file)));
    await runScan({ blobs: captured.map((c) => c.blob) });
  }

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
      // POST /parts/:partId/images enqueues an AI grading job for the new
      // image, and a successful grade sets the part back to pending_review.
      // That is the whole "so it can be graded again" path -- no separate
      // re-grade endpoint is needed or exists.
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
      <div className="flex flex-col gap-3">
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Couldn&apos;t load this vehicle.
        </p>
        <div>
          <Button variant="outline" onClick={reload}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!vehicle) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const described = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
  const missingPhotos = vehicle.parts.filter((p) => p.photosCount === 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/vehicles"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to vehicles
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">{described || vehicle.vin}</h1>
          <span className="text-sm capitalize text-muted-foreground">{vehicle.crushStatus}</span>
        </div>
        <p className="text-sm text-muted-foreground">{vehicle.vin}</p>
      </div>

      {uploadError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {uploadError}
        </p>
      )}

      {missingPhotos.length > 0 && (
        <div
          data-testid="missing-photos-summary"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
        >
          <p className="font-medium">
            {missingPhotos.length === 1
              ? "1 part has no photo and can't be graded"
              : `${missingPhotos.length} parts have no photo and can't be graded`}
          </p>
          <p className="mt-1 text-muted-foreground">
            Grading runs per photo, so a part with none never leaves its current status. Add
            one below to put it through the AI.
          </p>
        </div>
      )}

      <section
        data-testid="ai-scan-panel"
        className="flex flex-col gap-3 rounded-xl border border-border p-4"
      >
        <div>
          <h2 className="text-sm font-medium">AI part scan</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Finds every part it can see in a photo, grades each one, and files them for
            review. Uses the VIN to know what this vehicle should have.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={scanning || vehicle.images.length === 0}
            onClick={() => void runScan({ useExistingImages: true })}
          >
            {scanning
              ? "Scanning…"
              : `Scan the ${vehicle.images.length} photo${
                  vehicle.images.length === 1 ? "" : "s"
                } already here`}
          </Button>
          {vehicle.images.length === 0 && (
            <span className="text-xs text-muted-foreground">
              No stored photos yet — add some below, or scan new ones.
            </span>
          )}
        </div>

        <div className="max-w-md">
          <PhotoPicker
            inputId="scan-new-photos"
            label={scanning ? "Scanning…" : "Scan new photos"}
            multiple
            onFilesSelected={(files) => void handleScanFiles(files)}
          />
        </div>

        {scanning && (
          <p role="status" className="text-sm text-muted-foreground">
            Analyzing photos with the AI — this usually takes 20–40 seconds.
          </p>
        )}

        {scanError && (
          <p role="alert" className="text-sm text-destructive">
            {scanError}
          </p>
        )}

        {scanResult && (
          <div data-testid="scan-result" className="flex flex-col gap-3 text-sm">
            <p className="font-medium">
              {scanResult.partsCreated} new{" "}
              {scanResult.partsCreated === 1 ? "part" : "parts"} identified and graded
              {scanResult.partsUpdated > 0 &&
                `, ${scanResult.partsUpdated} existing updated`}
              .
            </p>

            {scanResult.needsGrading > 0 && (
              <p className="text-amber-700 dark:text-amber-400">
                {scanResult.needsGrading}{" "}
                {scanResult.needsGrading === 1 ? "part needs" : "parts need"} a person to
                grade — the AI wasn&apos;t confident enough. Try a clearer photo.
              </p>
            )}

            {/* Photo clarity: a warning, never a blocker. A poor photo still
                contributes whatever parts it managed. */}
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {scanResult.photos.map((photo) => (
                <li key={photo.index} data-testid={`scan-photo-${photo.index}`}>
                  Photo {photo.index + 1}: {CLARITY_LABEL[photo.clarity] ?? photo.clarity}
                  {photo.error
                    ? ` — ${photo.error}`
                    : ` — ${photo.detections} part${
                        photo.detections === 1 ? "" : "s"
                      } found`}
                  {photo.note ? ` (${photo.note})` : ""}
                </li>
              ))}
            </ul>

            {scanResult.unresolved.length > 0 && (
              <div
                data-testid="scan-unresolved"
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"
              >
                <p className="font-medium">
                  {scanResult.unresolved.length} thing
                  {scanResult.unresolved.length === 1 ? "" : "s"} the AI saw but
                  couldn&apos;t file
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {scanResult.unresolved.map((item, i) => (
                    <li key={`${item.partName}-${item.photoIndex}-${i}`}>
                      &ldquo;{item.partName}&rdquo; (photo {item.photoIndex + 1}) —{" "}
                      {item.reason === "ambiguous"
                        ? "couldn't tell which side"
                        : "no matching part type"}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Nothing was guessed. Add these by hand if you want them.
                </p>
              </div>
            )}

            <div data-testid="scan-roster">
              <p className="font-medium">
                {scanResult.roster.found.length} of {scanResult.roster.expected.length}{" "}
                expected exterior parts recorded
                {scanResult.roster.bodyClass
                  ? ` (${scanResult.roster.doors ?? "?"}-door ${scanResult.roster.bodyClass})`
                  : ""}
              </p>
              {scanResult.roster.missing.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Still missing: {scanResult.roster.missing.join(", ")}
                </p>
              )}
              {scanResult.roster.approximate && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This VIN didn&apos;t decode fully, so the expected list is a rough
                  guide rather than a complete one.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Graded parts are waiting in the Review Queue. Approve them there before
              they can be exported.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
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
          <div className="flex max-w-md flex-col gap-2">
            <p className="text-sm font-medium capitalize">Add {addingAngle} photo</p>
            <PhotoPicker
              inputId={`vehicle-photo-${addingAngle}`}
              label={uploading === `exterior:${addingAngle}` ? "Uploading…" : "Choose photo"}
              onFileSelected={(file) => void handleExteriorFile(addingAngle, file)}
            />
            <Button variant="outline" onClick={() => setAddingAngle(null)}>
              Cancel
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Exterior photos are reference only — they aren&apos;t AI-graded.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-medium">Parts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Adding a photo to a part re-grades it, so it returns to the Review Queue as
            pending review — including a part you&apos;ve already approved.
          </p>
        </div>

        {vehicle.parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts on this vehicle.</p>
        ) : (
          <ul className="grid gap-2">
            {vehicle.parts.map((part) => (
              <li
                key={part.id}
                data-testid={`part-row-${part.id}`}
                className="rounded-xl border border-border p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{part.taxonomyName ?? "Part"}</span>
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="capitalize">{part.status.replace(/_/g, " ")}</span>
                      <span aria-hidden="true">·</span>
                      {part.photosCount === 0 ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                          No photos
                        </span>
                      ) : (
                        <span>
                          {part.photosCount} {part.photosCount === 1 ? "photo" : "photos"}
                        </span>
                      )}
                    </span>
                  </div>
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
                  <div className="mt-3 flex max-w-md flex-col gap-2">
                    <PhotoPicker
                      inputId={`part-photo-${part.id}`}
                      label={uploading === `part:${part.id}` ? "Uploading…" : "Choose photo"}
                      onFileSelected={(file) => void handlePartFile(part.id, file)}
                    />
                    <Button variant="outline" onClick={() => setAddingPartId(null)}>
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
