"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { useCamera } from "@/hooks/use-camera";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { useIntakeStore } from "@/lib/offline/store";
import type { VehicleDraft, VehicleImageAngle } from "@/lib/offline/types";

const REQUIRED_ANGLES: VehicleImageAngle[] = ["front", "rear", "left", "right"];

function VehicleForm({ draftId, draft }: { draftId: string; draft: VehicleDraft }) {
  const router = useRouter();
  const setDecoded = useIntakeStore((s) => s.setDecoded);
  const addExteriorPhoto = useIntakeStore((s) => s.addExteriorPhoto);

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

  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();

  const capturedAngles = useMemo(
    () => new Set(draft.exteriorPhotos.map((p) => p.angle)),
    [draft.exteriorPhotos],
  );
  const nextAngle = REQUIRED_ANGLES.find((angle) => !capturedAngles.has(angle));
  const allCaptured = capturedAngles.size >= REQUIRED_ANGLES.length;

  async function handleCapture() {
    if (!nextAngle || !videoRef.current) return;
    setCapturing(true);
    try {
      const { blob, qualityFlags } = await captureFrame(videoRef.current);
      await addExteriorPhoto(draftId, {
        id: crypto.randomUUID(),
        blob,
        angle: nextAngle,
        qualityFlags,
        capturedAt: new Date().toISOString(),
      });
    } finally {
      setCapturing(false);
    }
  }

  async function handleFileSelected(file: File) {
    if (!nextAngle) return;
    const { blob, qualityFlags } = await captureFromFile(file);
    await addExteriorPhoto(draftId, {
      id: crypto.randomUUID(),
      blob,
      angle: nextAngle,
      qualityFlags,
      capturedAt: new Date().toISOString(),
    });
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
          <span className="text-sm text-muted-foreground">{capturedAngles.size} / 4</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {REQUIRED_ANGLES.map((angle) => {
            const photo = draft.exteriorPhotos.find((p) => p.angle === angle);
            return (
              <div
                key={angle}
                className="flex h-20 flex-col items-center justify-center gap-1 rounded-lg border border-border text-xs capitalize"
              >
                <span>{angle}</span>
                {photo ? (
                  photo.qualityFlags.blurry || photo.qualityFlags.tooDark ? (
                    <span className="text-destructive">
                      {photo.qualityFlags.blurry ? "Blurry" : "Too dark"} — retake
                    </span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400">Captured</span>
                  )
                ) : (
                  <span className="text-muted-foreground">Not yet</span>
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
        {nextAngle && (
          <PhotoPicker
            inputId="vehicle-photo-picker"
            label={`Choose photo for ${nextAngle}`}
            onFileSelected={(file) => void handleFileSelected(file)}
          />
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={!allCaptured || submitting}
        onClick={(e) => void handleSubmit(e)}
      >
        Continue
      </Button>
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
