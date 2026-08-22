"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { useCamera } from "@/hooks/use-camera";
import { apiBaseUrl } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { captureFrame, captureFromFile } from "@/lib/offline/capture";
import { useIntakeStore } from "@/lib/offline/store";
import { createFetchSyncClient, syncPendingDrafts } from "@/lib/offline/sync";
import type { VehicleDraft } from "@/lib/offline/types";
import { randomUUID } from "@/lib/uuid";

function VehicleForm({ draftId, draft }: { draftId: string; draft: VehicleDraft }) {
  const router = useRouter();
  const setDecoded = useIntakeStore((s) => s.setDecoded);
  const addPhoto = useIntakeStore((s) => s.addPhoto);
  const queueForSync = useIntakeStore((s) => s.queueForSync);

  // Lazy initializers, not an effect: this component only mounts once
  // `draft` (and therefore `draft.decoded`, prefilled or not) is already
  // known — see the loading gate in VehiclePageClient below — so there's no
  // "data arrives later" race to synchronize, just a one-time initial value.
  const [make, setMake] = useState(() => draft.decoded?.make ?? "");
  const [model, setModel] = useState(() => draft.decoded?.model ?? "");
  const [year, setYear] = useState(() => (draft.decoded?.year ? String(draft.decoded.year) : ""));
  const [trim, setTrim] = useState(() => draft.decoded?.trim ?? "");
  const [capturing, setCapturing] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { videoRef, ready: cameraReady, error: cameraError } = useCamera();

  const hasPhoto = draft.photos.length > 0;

  async function handleCapture() {
    if (!videoRef.current) return;
    setCapturing(true);
    try {
      const { blob, qualityFlags } = await captureFrame(videoRef.current);
      await addPhoto(draftId, {
        id: randomUUID(),
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
    await addPhoto(draftId, {
      id: randomUUID(),
      blob,
      qualityFlags,
      capturedAt: new Date().toISOString(),
    });
  }

  async function handleFinish() {
    setFinishing(true);
    setSyncError(null);
    try {
      await setDecoded(draftId, {
        make: make.trim() || null,
        model: model.trim() || null,
        year: year ? Number.parseInt(year, 10) || null : null,
        trim: trim.trim() || null,
        raw: draft.decoded?.raw ?? {},
      });
      await queueForSync(draftId);

      // Queuing alone never sends anything -- it just marks the draft
      // "queued" in IndexedDB and relies on the online-event listener /
      // Background Sync (which doesn't fire at all over plain HTTP, see
      // lib/pwa.ts) to eventually pick it up. Attempt a real send right
      // now so "Finish" actually finishes when the device is online,
      // instead of silently stranding the draft until someone happens to
      // visit the Sync queue screen and tap "Sync now".
      const token = useAuthSession.getState().token;
      if (token) {
        const client = createFetchSyncClient(apiBaseUrl(), () => token);
        await syncPendingDrafts(client);
      }

      const result = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      if (result?.status === "sync_failed") {
        setSyncError(
          result.syncError
            ? `Couldn't send yet: ${result.syncError}. It's queued and will retry automatically, or you can retry from the Sync queue.`
            : "Couldn't send yet. It's queued and will retry automatically, or you can retry from the Sync queue.",
        );
        return;
      }
      router.push("/");
    } finally {
      setFinishing(false);
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
          <h2 className="text-sm font-medium">Photos</h2>
          <span className="text-sm text-muted-foreground">{draft.photos.length} captured</span>
        </div>

        {cameraReady && (
          <div className="space-y-2">
            <video ref={videoRef} className="w-full rounded-lg" muted playsInline>
              <track kind="captions" />
            </video>
            <Button
              type="button"
              className="w-full"
              disabled={capturing}
              onClick={() => void handleCapture()}
            >
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
          inputId="vehicle-photo-picker"
          label="Choose photo"
          onFileSelected={(file) => void handleFileSelected(file)}
        />

        {hasPhoto && (
          <ul className="grid gap-1">
            {draft.photos.map((photo, i) => (
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
      </div>

      {syncError && (
        <p role="alert" className="text-sm text-destructive">
          {syncError}
        </p>
      )}

      {!hasPhoto && (
        <p className="text-sm text-muted-foreground">
          No photos yet — you can still send with whatever you have and add more later.
        </p>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={finishing}
        onClick={() => void handleFinish()}
      >
        {finishing ? "Sending…" : "Finish & send"}
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
