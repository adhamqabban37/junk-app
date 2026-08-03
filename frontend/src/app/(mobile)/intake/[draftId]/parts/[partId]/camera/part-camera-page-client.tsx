"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { useCamera } from "@/hooks/use-camera";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { useIntakeStore } from "@/lib/offline/store";

export default function PartCameraPageClient({
  draftId,
  partId,
}: {
  draftId: string;
  partId: string;
}) {
  const router = useRouter();
  const drafts = useIntakeStore((s) => s.drafts);
  const hydrated = useIntakeStore((s) => s.hydrated);
  const hydrate = useIntakeStore((s) => s.hydrate);
  const addPartPhoto = useIntakeStore((s) => s.addPartPhoto);
  const draft = drafts.find((d) => d.id === draftId);
  const part = draft?.parts.find((p) => p.id === partId);

  const [capturing, setCapturing] = useState(false);
  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();

  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  async function handleCapture() {
    if (!videoRef.current) return;
    setCapturing(true);
    try {
      const { blob, qualityFlags } = await captureFrame(videoRef.current);
      await addPartPhoto(draftId, partId, {
        id: crypto.randomUUID(),
        blob,
        qualityFlags,
        capturedAt: new Date().toISOString(),
      });
    } finally {
      setCapturing(false);
    }
  }

  async function handleFileSelected(file: File) {
    const { blob, qualityFlags } = await captureFromFile(file);
    await addPartPhoto(draftId, partId, {
      id: crypto.randomUUID(),
      blob,
      qualityFlags,
      capturedAt: new Date().toISOString(),
    });
  }

  if (!draft || !part) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const hasPhoto = part.photos.length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">{part.taxonomyName}</h1>
      <p className="text-sm text-muted-foreground">{part.photos.length} photo(s) captured</p>

      {cameraReady ? (
        <div className="relative space-y-2">
          <div className="relative">
            { }
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline>
              <track kind="captions" />
            </video>
            {/* Ghost overlay: a generic centered framing guide (no per-part
                reference silhouette art exists yet — a real per-taxonomy
                outline is a follow-up, not part of this MVP). */}
            <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/70" />
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={capturing}
            onClick={() => void handleCapture()}
          >
            Capture photo
          </Button>
        </div>
      ) : (
        cameraError && (
          <p role="alert" className="text-sm text-destructive">
            {cameraError}
          </p>
        )
      )}

      <PhotoPicker
        inputId="part-photo-picker"
        label="Choose photo"
        onFileSelected={(file) => void handleFileSelected(file)}
      />

      {hasPhoto && (
        <ul className="grid gap-1">
          {part.photos.map((photo, i) => (
            <li key={photo.id} className="flex items-center justify-between text-sm">
              <span>Photo {i + 1}</span>
              {(photo.qualityFlags.blurry || photo.qualityFlags.tooDark) && (
                <span className="text-destructive">
                  {photo.qualityFlags.blurry ? "Blurry" : "Too dark"} — consider retaking
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        className="w-full"
        disabled={!hasPhoto}
        onClick={() => router.push(`/intake/${draftId}/parts`)}
      >
        Done
      </Button>
    </div>
  );
}
