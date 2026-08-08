"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { Button } from "@/components/ui/button";
import { ApiError, detectParts, type DetectedPartResponse } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { captureFromFile } from "@/lib/offline/capture";
import { planDetectionMerge, type AcceptedDetection } from "@/lib/offline/detections";
import { useIntakeStore } from "@/lib/offline/store";
import { useTaxonomyStore } from "@/lib/offline/taxonomy-store";
import type { DraftPhoto } from "@/lib/offline/types";

type Phase = "picking" | "analyzing" | "reviewing";

/** One detection plus the per-row state the worker can change. */
interface ReviewRow {
  key: string;
  photo: DraftPhoto;
  photoIndex: number;
  detection: DetectedPartResponse;
  accepted: boolean;
  /** What this row will be filed as. Empty means "needs a choice". */
  taxonomyId: string;
}

function gradeTone(grade: string): string {
  if (grade === "A") return "bg-green-100 text-green-900";
  if (grade === "B") return "bg-amber-100 text-amber-900";
  return "bg-red-100 text-red-900";
}

export default function ScanPageClient({ draftId }: { draftId: string }) {
  const router = useRouter();
  const token = useAuthSession((s) => s.token);

  const drafts = useIntakeStore((s) => s.drafts);
  const draftsHydrated = useIntakeStore((s) => s.hydrated);
  const hydrateDrafts = useIntakeStore((s) => s.hydrate);
  const applyDetectionPlan = useIntakeStore((s) => s.applyDetectionPlan);
  const draft = drafts.find((d) => d.id === draftId);

  const taxonomyItems = useTaxonomyStore((s) => s.items);
  const taxonomyHydrated = useTaxonomyStore((s) => s.hydrated);
  const hydrateTaxonomy = useTaxonomyStore((s) => s.hydrate);

  const [phase, setPhase] = useState<Phase>("picking");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draftsHydrated) void hydrateDrafts();
  }, [draftsHydrated, hydrateDrafts]);

  useEffect(() => {
    if (!taxonomyHydrated) void hydrateTaxonomy();
  }, [taxonomyHydrated, hydrateTaxonomy]);

  const taxonomyById = useMemo(
    () => new Map(taxonomyItems.map((t) => [t.id, t])),
    [taxonomyItems],
  );

  async function handleFiles(files: File[]) {
    if (!token) {
      setError("You need to be logged in to scan photos.");
      return;
    }
    setPhase("analyzing");
    setError(null);
    setPhotoErrors([]);

    try {
      // Re-drawn through the same canvas pipeline the rest of intake uses,
      // so bulk-uploaded photos get identical blur/lighting flags and a
      // consistent JPEG regardless of what the phone handed us.
      const captured = await Promise.all(files.map((file) => captureFromFile(file)));
      const photos: DraftPhoto[] = captured.map((result) => ({
        id: crypto.randomUUID(),
        blob: result.blob,
        qualityFlags: result.qualityFlags,
        capturedAt: new Date().toISOString(),
      }));

      const images = await detectParts(
        token,
        photos.map((p) => p.blob),
      );

      const nextRows: ReviewRow[] = [];
      const failures: string[] = [];
      for (const image of images) {
        if (image.error) {
          failures.push(`Photo ${image.index + 1}: ${image.error}`);
          continue;
        }
        image.detections.forEach((detection, i) => {
          nextRows.push({
            key: `${image.index}-${i}`,
            photo: photos[image.index],
            photoIndex: image.index,
            detection,
            // Pre-ticked only when the AI actually resolved it. An ambiguous
            // or unmapped row starts unticked so nobody can confirm a whole
            // batch and silently file a part that was never identified.
            accepted: detection.taxonomyId !== null,
            taxonomyId: detection.taxonomyId ?? "",
          });
        });
      }

      setRows(nextRows);
      setPhotoErrors(failures);
      setPhase("reviewing");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't analyze those photos. Check your connection and try again.",
      );
      setPhase("picking");
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const accepted: AcceptedDetection[] = rows
        .filter((row) => row.accepted && row.taxonomyId)
        .map((row) => ({
          taxonomyId: row.taxonomyId,
          taxonomyName: taxonomyById.get(row.taxonomyId)?.name ?? row.detection.partName,
          photo: row.photo,
          grade: row.detection.grade,
          damageCodes: row.detection.damageCodes,
          confidence: row.detection.confidence,
        }));

      const plan = planDetectionMerge(accepted, draft?.parts ?? []);
      await applyDetectionPlan(draftId, plan);
      router.push(`/intake/${draftId}/parts`);
    } finally {
      setSaving(false);
    }
  }

  function updateRow(key: string, patch: Partial<ReviewRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  const acceptedCount = rows.filter((r) => r.accepted && r.taxonomyId).length;
  const needsChoice = rows.filter((r) => r.accepted && !r.taxonomyId).length;

  if (!draft) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Scan parts from photos</h1>
        <p className="text-sm text-muted-foreground">
          Add photos of the vehicle from every side. The AI finds and grades the parts it
          can see, then you confirm.
        </p>
      </div>

      {phase === "picking" && (
        <>
          <PhotoPicker
            inputId="scan-photos"
            label="Choose photos"
            multiple
            onFilesSelected={(files) => void handleFiles(files)}
          />
          <p className="text-xs text-muted-foreground">
            Needs a connection — the AI runs on the server. What you confirm is saved to
            this device and syncs like everything else.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}

      {phase === "analyzing" && (
        <p className="text-sm text-muted-foreground">Analyzing photos…</p>
      )}

      {phase === "reviewing" && (
        <>
          {photoErrors.length > 0 && (
            <div role="alert" className="space-y-1 text-sm text-destructive">
              {photoErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No parts found in those photos. Try shots that show the parts more clearly.
            </p>
          ) : (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">
                Found {rows.length} {rows.length === 1 ? "part" : "parts"}
              </h2>
              <ul className="grid gap-2">
                {rows.map((row) => {
                  const isAmbiguous =
                    row.detection.taxonomyId === null &&
                    row.detection.candidateIds.length > 0;
                  const isUnmapped =
                    row.detection.taxonomyId === null &&
                    row.detection.candidateIds.length === 0;
                  const options = isAmbiguous
                    ? row.detection.candidateIds
                        .map((id) => taxonomyById.get(id))
                        .filter((t) => t !== undefined)
                    : taxonomyItems;

                  return (
                    <li
                      key={row.key}
                      className="space-y-2 rounded-lg border border-border p-3"
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id={`accept-${row.key}`}
                          className="mt-1 h-4 w-4"
                          checked={row.accepted}
                          onChange={(e) =>
                            updateRow(row.key, { accepted: e.target.checked })
                          }
                        />
                        <div className="flex-1 space-y-1">
                          <label
                            htmlFor={`accept-${row.key}`}
                            className="flex flex-wrap items-center gap-2 text-sm font-medium"
                          >
                            <span>
                              {row.detection.taxonomyName ?? row.detection.partName}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-xs ${gradeTone(
                                row.detection.grade,
                              )}`}
                            >
                              Grade {row.detection.grade}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                              {Math.round(row.detection.confidence * 100)}% · photo{" "}
                              {row.photoIndex + 1}
                            </span>
                          </label>

                          {row.detection.damageCodes.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {row.detection.damageCodes.join(", ")}
                            </p>
                          )}

                          {/* The AI's own wording is kept visible whenever it
                              differs from the taxonomy row, so the worker can
                              tell what it actually saw before agreeing. */}
                          {row.detection.taxonomyName &&
                            row.detection.partName.toLowerCase() !==
                              row.detection.taxonomyName.toLowerCase() && (
                              <p className="text-xs text-muted-foreground">
                                AI saw: “{row.detection.partName}”
                              </p>
                            )}

                          {isAmbiguous && (
                            <p className="text-xs text-amber-700">
                              Which one? AI saw “{row.detection.partName}” but couldn&apos;t
                              tell the side.
                            </p>
                          )}
                          {isUnmapped && (
                            <p className="text-xs text-amber-700">
                              No matching part for “{row.detection.partName}” — pick one to
                              keep it.
                            </p>
                          )}

                          {row.detection.taxonomyId === null && (
                            <select
                              aria-label={`Part for ${row.detection.partName}`}
                              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                              value={row.taxonomyId}
                              onChange={(e) =>
                                updateRow(row.key, { taxonomyId: e.target.value })
                              }
                            >
                              <option value="">Choose a part…</option>
                              {options.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {needsChoice > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {needsChoice} ticked{" "}
              {needsChoice === 1 ? "part still needs" : "parts still need"} a part type.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setRows([]);
                setPhotoErrors([]);
                setPhase("picking");
              }}
            >
              Add more photos
            </Button>
            <Button
              className="flex-1"
              disabled={acceptedCount === 0 || saving}
              onClick={() => void handleConfirm()}
            >
              Add {acceptedCount > 0 ? acceptedCount : ""}{" "}
              {acceptedCount === 1 ? "part" : "parts"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
