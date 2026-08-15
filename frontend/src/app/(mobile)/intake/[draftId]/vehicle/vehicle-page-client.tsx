"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftPhotoView } from "@/components/mobile/draft-photo";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { useCamera } from "@/hooks/use-camera";
import { classifyVehiclePhotos } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { randomId } from "@/lib/random-id";
import { useIntakeStore } from "@/lib/offline/store";
import type { VehicleDraft, VehicleImageAngle } from "@/lib/offline/types";

const REQUIRED_ANGLES: VehicleImageAngle[] = ["front", "rear", "left", "right"];

function VehicleForm({ draftId, draft }: { draftId: string; draft: VehicleDraft }) {
  const router = useRouter();
  const setDecoded = useIntakeStore((s) => s.setDecoded);
  const addExteriorPhoto = useIntakeStore((s) => s.addExteriorPhoto);
  const addExteriorPhotos = useIntakeStore((s) => s.addExteriorPhotos);
  const setExteriorPhotoAngle = useIntakeStore((s) => s.setExteriorPhotoAngle);
  const removeExteriorPhoto = useIntakeStore((s) => s.removeExteriorPhoto);
  const token = useAuthSession((s) => s.token);

  // Lazy initializers, not an effect: this component only mounts once
  // `draft` (and therefore `draft.decoded`, prefilled or not) is already
  // known — see the loading gate in VehiclePageClient below — so there's no
  // "data arrives later" race to synchronize, just a one-time initial value.
  const [make, setMake] = useState(() => draft.decoded?.make ?? "");
  const [model, setModel] = useState(() => draft.decoded?.model ?? "");
  const [year, setYear] = useState(() => (draft.decoded?.year ? String(draft.decoded.year) : ""));
  const [trim, setTrim] = useState(() => draft.decoded?.trim ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);

  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();

  const capturedAngles = useMemo(
    () =>
      new Set(
        draft.exteriorPhotos
          .map((p) => p.angle)
          .filter((a): a is VehicleImageAngle => Boolean(a)),
      ),
    [draft.exteriorPhotos],
  );
  // Photos the AI couldn't place, or that were added offline. These block
  // Continue: the sync endpoint validates every exterior photo's angle
  // against the enum and 400s the whole draft on an unassigned one, so
  // letting a worker past here would fail their sync later, far from the
  // cause.
  const unassigned = useMemo(
    () => draft.exteriorPhotos.filter((p) => !p.angle),
    [draft.exteriorPhotos],
  );
  const nextAngle = REQUIRED_ANGLES.find((angle) => !capturedAngles.has(angle));
  const allCaptured = capturedAngles.size >= REQUIRED_ANGLES.length;

  /**
   * Continue on whatever the worker actually has.
   *
   * All four angles used to be mandatory. That is a reasonable ideal and a
   * bad requirement: a car may be against a wall, wrecked on one side, or
   * simply photographed from two angles because that is all the parts worth
   * pulling are visible from. Blocking the whole intake for a missing "left"
   * shot stops work over a photo nobody needs.
   *
   * The one rule that does survive is per-photo, not per-vehicle: every
   * photo present must have an angle, because POST /vehicles/intake
   * validates each exterior photo's angle against the enum and 400s the
   * entire draft on an unassigned one. That failure would surface at sync,
   * far from its cause, so it is caught here instead.
   */
  const canContinue = unassigned.length === 0;

  async function handleCapture() {
    if (!nextAngle || !videoRef.current) return;
    setCapturing(true);
    try {
      const { blob, qualityFlags } = await captureFrame(videoRef.current);
      await addExteriorPhoto(draftId, {
        id: randomId(),
        blob,
        angle: nextAngle,
        qualityFlags,
        capturedAt: new Date().toISOString(),
      });
    } finally {
      setCapturing(false);
    }
  }

  /**
   * Bulk drop: take every photo the worker selected, then ask the AI which
   * side of the vehicle each one shows.
   *
   * Order of operations matters. The photos are written to the draft FIRST
   * and the classification is applied after, so a failed or offline
   * classify call costs the worker nothing but the sorting -- their photos
   * are already saved and they can assign angles by hand. Storing them only
   * on success would make the whole exterior step require a connection,
   * which the rest of intake deliberately does not.
   */
  async function handleFilesSelected(files: File[]) {
    setSorting(true);
    setSortError(null);
    try {
      const captured = await Promise.all(
        files.map(async (file) => {
          const { blob, qualityFlags } = await captureFromFile(file);
          return {
            id: randomId(),
            blob,
            qualityFlags,
            capturedAt: new Date().toISOString(),
          };
        }),
      );
      await addExteriorPhotos(draftId, captured);

      if (!token) {
        setSortError("Not signed in — assign the angles below.");
        return;
      }

      const results = await classifyVehiclePhotos(
        token,
        captured.map((p) => p.blob),
      );

      for (const result of results) {
        const photo = captured[result.index];
        // `unknown` is left unassigned on purpose rather than guessed at.
        // A photo filed under the wrong side is worse than one the worker
        // has to sort, and they are standing at the vehicle.
        if (!photo || result.angle === "unknown") continue;
        await setExteriorPhotoAngle(draftId, photo.id, result.angle);
      }
    } catch {
      setSortError("Couldn't sort these automatically — assign the angles below.");
    } finally {
      setSorting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await setDecoded(draftId, {
        make: make.trim() || null,
        model: model.trim() || null,
        year: year ? Number.parseInt(year, 10) || null : null,
        trim: trim.trim() || null,
        raw: draft.decoded?.raw ?? {},
      });
      router.push(`/intake/${draftId}/parts`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Vehicle details</h1>

      <form className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="make" className="text-sm font-medium">
            Make
          </label>
          <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="model" className="text-sm font-medium">
            Model
          </label>
          <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="year" className="text-sm font-medium">
            Year
          </label>
          <Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="trim" className="text-sm font-medium">
            Trim
          </label>
          <Input id="trim" value={trim} onChange={(e) => setTrim(e.target.value)} />
        </div>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Exterior photos</h2>
          {/* Photo count first: it is the thing the worker controls. The
              angle tally is coverage information, not a target to hit. */}
          <span className="text-sm text-muted-foreground">
            {draft.exteriorPhotos.length}{" "}
            {draft.exteriorPhotos.length === 1 ? "photo" : "photos"} ·{" "}
            {capturedAngles.size} / 4 angles
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {REQUIRED_ANGLES.map((angle) => {
            const photo = draft.exteriorPhotos.find((p) => p.angle === angle);
            return (
              <div
                key={angle}
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-2 text-xs capitalize"
              >
                {photo ? (
                  // Keyed by photo id so swapping which photo holds this
                  // angle rebuilds the object URL instead of showing a
                  // stale one.
                  <DraftPhotoView
                    key={photo.id}
                    blob={photo.blob}
                    alt={`${angle} of the vehicle`}
                    className="h-20 w-full"
                  />
                ) : (
                  <div className="flex h-20 w-full items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                    Not yet
                  </div>
                )}
                <span>{angle}</span>
                {photo && (photo.qualityFlags.blurry || photo.qualityFlags.tooDark) && (
                  <span className="text-destructive">
                    {photo.qualityFlags.blurry ? "Blurry" : "Too dark"} — retake
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {cameraReady && nextAngle && (
          <div className="space-y-2">
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline>
              <track kind="captions" />
            </video>
            <p className="text-center text-sm text-muted-foreground capitalize">
              Line up the {nextAngle} of the vehicle
            </p>
            <Button
              type="button"
              className="w-full"
              disabled={capturing}
              onClick={() => void handleCapture()}
            >
              Capture {nextAngle}
            </Button>
          </div>
        )}
        {!cameraReady && cameraError && !allCaptured && (
          <p role="alert" className="text-sm text-destructive">
            {cameraError}
          </p>
        )}
        <PhotoPicker
          inputId="vehicle-photo-picker"
          label="Choose photos of the vehicle"
          multiple
          onFilesSelected={(files) => void handleFilesSelected(files)}
        />
        <p className="text-xs text-muted-foreground">
          Select all of them at once — the AI sorts them into front, rear, left and right.
        </p>

        {sorting && (
          <p role="status" className="text-sm text-muted-foreground">
            Sorting photos…
          </p>
        )}
        {sortError && (
          <p role="alert" className="text-sm text-destructive">
            {sortError}
          </p>
        )}

        {unassigned.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">
              {unassigned.length === 1
                ? "1 photo needs an angle"
                : `${unassigned.length} photos need an angle`}
            </p>
            <p className="text-xs text-muted-foreground">
              The AI wasn&apos;t sure which side these show. Pick one, or remove the photo.
            </p>
            {unassigned.map((photo) => (
              <div
                key={photo.id}
                className="flex gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <DraftPhotoView
                  blob={photo.blob}
                  alt="Vehicle photo awaiting an angle"
                  className="h-24 w-24 shrink-0"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Which side of the vehicle is this?
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {REQUIRED_ANGLES.map((angle) => (
                      <Button
                        key={angle}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="capitalize"
                        onClick={() =>
                          void setExteriorPhotoAngle(draftId, photo.id, angle)
                        }
                      >
                        {angle}
                      </Button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start text-muted-foreground"
                    onClick={() => void removeExteriorPhoto(draftId, photo.id)}
                  >
                    Remove photo
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={!canContinue || submitting || sorting}
        onClick={(e) => void handleSubmit(e)}
      >
        Continue
      </Button>
      {!canContinue && !sorting && (
        <p className="text-center text-xs text-muted-foreground">
          Assign an angle to every photo to continue.
        </p>
      )}
      {/* Informational, never blocking -- see canContinue above. A worker
          who knows the left side is against a wall should not be nagged
          into taking a photo that does not exist. */}
      {canContinue && !allCaptured && draft.exteriorPhotos.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          No photo yet for: {REQUIRED_ANGLES.filter((a) => !capturedAngles.has(a)).join(", ")}.
          You can continue anyway.
        </p>
      )}
    </div>
  );
}

export default function VehiclePageClient({ draftId }: { draftId: string }) {
  const drafts = useIntakeStore((s) => s.drafts);
  const hydrated = useIntakeStore((s) => s.hydrated);
  const hydrate = useIntakeStore((s) => s.hydrate);
  const draft = drafts.find((d) => d.id === draftId);

  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  if (!draft) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return <VehicleForm key={draft.id} draftId={draftId} draft={draft} />;
}
