"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DraftPhotoView } from "@/components/mobile/draft-photo";
import { PhotoPicker } from "@/components/mobile/photo-picker";
import { Button } from "@/components/ui/button";
import { ApiError, detectParts, type DetectedPartResponse } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { captureFromFile } from "@/lib/offline/capture";
import { randomId } from "@/lib/random-id";
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
  // C is real damage, D is severe -- distinct tones so a worker can tell
  // them apart at a glance rather than reading every badge.
  if (grade === "C") return "bg-orange-100 text-orange-900";
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
  /** The row whose photo is open full-size, or null. */
  const [zoomed, setZoomed] = useState<ReviewRow | null>(null);

  useEffect(() => {
    if (!draftsHydrated) void hydrateDrafts();
  }, [draftsHydrated, hydrateDrafts]);

  useEffect(() => {
    if (!taxonomyHydrated) void hydrateTaxonomy();
  }, [taxonomyHydrated, hydrateTaxonomy]);

  /**
   * Scan the vehicle's own photos as soon as the worker gets here, without
   * making them ask. They already uploaded the walkaround one step back;
   * arriving at a screen that ignores those and demands the same files
   * again is the complaint that prompted this.
   *
   * Guarded by a ref rather than by phase, so navigating back to this screen
   * does not silently re-bill a second full scan -- one Gemini call per
   * photo is real money, and a ten-photo walkaround is ten calls.
   */
  const autoScanStarted = useRef(false);
  useEffect(() => {
    if (autoScanStarted.current) return;
    if (!draftsHydrated || !draft || !token) return;
    if (draft.exteriorPhotos.length === 0) return;
    autoScanStarted.current = true;
    // Deferred one microtask: analyze() sets state on its first line, and
    // doing that synchronously inside an effect trips
    // react-hooks/set-state-in-effect (and would paint "picking" for a frame
    // before immediately replacing it).
    void Promise.resolve().then(() => analyzeExisting());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- analyzeExisting is redefined every render; the ref is what makes this run once
  }, [draftsHydrated, draft, token]);

  const taxonomyById = useMemo(
    () => new Map(taxonomyItems.map((t) => [t.id, t])),
    [taxonomyItems],
  );

  const existingPhotoCount = draft?.exteriorPhotos.length ?? 0;

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
        id: randomId(),
        blob: result.blob,
        qualityFlags: result.qualityFlags,
        capturedAt: new Date().toISOString(),
      }));
      await analyze(photos);
    } catch {
      setError("Couldn't read those photos. Try again.");
      setPhase("picking");
    }
  }

  /**
   * Runs detection over photos that are ALREADY in the draft.
   *
   * This is the path that matters: the worker photographed the vehicle one
   * step earlier, and until now the scan screen ignored those entirely and
   * demanded a second upload of the same files. That is the single biggest
   * piece of wasted work in intake -- ten photos re-picked and re-uploaded
   * on a yard connection, to analyze images the phone was already holding.
   */
  async function analyzeExisting() {
    if (!draft || draft.exteriorPhotos.length === 0) return;
    await analyze(draft.exteriorPhotos);
  }

  async function analyze(photos: DraftPhoto[]) {
    if (!token) {
      setError("You need to be logged in to scan photos.");
      return;
    }
    setPhase("analyzing");
    setError(null);
    setPhotoErrors([]);

    try {
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
      {zoomed && (
        // Deliberately not a <dialog>: this has to work on an old phone
        // browser in a yard, and a plain overlay has no support surprises.
        // Any tap closes it -- there is nothing to interact with inside, so
        // a dedicated close target would just be one more thing to hit.
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo graded for ${
            zoomed.detection.taxonomyName ?? zoomed.detection.partName
          }`}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
          onClick={() => setZoomed(null)}
        >
          <DraftPhotoView
            blob={zoomed.photo.blob}
            alt={`Photo the AI graded for ${
              zoomed.detection.taxonomyName ?? zoomed.detection.partName
            }`}
            className="max-h-[70vh] w-auto max-w-full"
          />
          <div className="text-center text-sm text-white">
            <p className="font-medium">
              {zoomed.detection.taxonomyName ?? zoomed.detection.partName} — Grade{" "}
              {zoomed.detection.grade}
            </p>
            <p className="text-white/70">
              {Math.round(zoomed.detection.confidence * 100)}% confident
              {zoomed.detection.damageCodes.length > 0 &&
                ` · ${zoomed.detection.damageCodes.join(", ")}`}
            </p>
            <p className="mt-2 text-xs text-white/50">Tap anywhere to close</p>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Scan parts from photos</h1>
        <p className="text-sm text-muted-foreground">
          The AI finds and grades the parts it can see in the vehicle&apos;s photos, then
          you confirm.
        </p>
      </div>

      {/* Required, not decorative: a worker can arrive here automatically
          from the parts step, and a screen you can be sent to must always
          have a way out that isn't the browser's back button. */}
      {phase !== "analyzing" && (
        <Button
          type="button"
          variant="ghost"
          className="self-start px-0 text-sm text-muted-foreground"
          onClick={() => router.push(`/intake/${draftId}/parts`)}
        >
          ← Pick parts by hand instead
        </Button>
      )}

      {phase === "picking" && (
        <>
          {existingPhotoCount > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                {existingPhotoCount} photo{existingPhotoCount === 1 ? "" : "s"} from this
                vehicle
              </p>
              <p className="text-xs text-muted-foreground">
                These are the photos you already added. No need to pick them again.
              </p>
              <Button
                type="button"
                className="w-full"
                onClick={() => void analyzeExisting()}
              >
                Scan {existingPhotoCount === 1 ? "it" : "them"} for parts
              </Button>
            </div>
          )}

          <PhotoPicker
            inputId="scan-photos"
            label={existingPhotoCount > 0 ? "Or add more photos" : "Choose photos"}
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
                        {/* The photo the grade came from. Confirming "Grade C,
                            82%, photo 3" without being able to look at photo 3
                            is not review, it is rubber-stamping -- and the
                            worker is the human-in-the-loop for this flow
                            (CLAUDE.md rule 5). Tap to see it full size. */}
                        <button
                          type="button"
                          aria-label={`View the photo graded for ${
                            row.detection.taxonomyName ?? row.detection.partName
                          }`}
                          onClick={() => setZoomed(row)}
                          className="shrink-0"
                        >
                          <DraftPhotoView
                            blob={row.photo.blob}
                            alt={`Photo the AI graded for ${
                              row.detection.taxonomyName ?? row.detection.partName
                            }`}
                            className="h-16 w-16"
                          />
                        </button>
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
