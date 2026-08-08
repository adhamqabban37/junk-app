"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { approvePart, listParts, type PartListItem } from "@/lib/api/parts";
import { getSettings } from "@/lib/api/settings";
import { recordCorrection } from "@/lib/api/corrections";
import { deleteVehicle } from "@/lib/api/vehicles";

const GRADES = ["A", "B", "C"] as const;

function needsReview(item: PartListItem, threshold: number): boolean {
  const analysis = item.latestAnalysis;
  if (!analysis || analysis.status !== "complete") return true;
  if (analysis.confidence === null) return true;
  return Number(analysis.confidence) < threshold;
}

export default function ReviewQueuePage() {
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<PartListItem[] | null>(null);
  const [threshold, setThreshold] = useState(0.7);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [gradeOverrides, setGradeOverrides] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Which row has its "delete this vehicle" confirmation open. Keyed by
  // part id (the row), though what gets deleted is that row's *vehicle*.
  const [confirmingPartId, setConfirmingPartId] = useState<string | null>(null);
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getSettings(token)
      .then((settings) => setThreshold(settings.aiConfidenceThreshold))
      .catch(() => {
        // Fall back to the built-in default (0.7) if settings can't be fetched.
      });
    listParts(token, { status: ["pending_review", "needs_manual_grading"], pageSize: 200 })
      .then((res) => {
        setError(false);
        setItems(res.items);
      })
      .catch(() => setError(true));
  }, [token, attempt]);

  async function handleApprove(item: PartListItem) {
    if (!token || !item.latestAnalysis || submittingId) return;
    setSubmittingId(item.id);
    try {
      const overrideGrade = gradeOverrides[item.id];
      if (overrideGrade && overrideGrade !== item.latestAnalysis.grade) {
        await recordCorrection(token, item.latestAnalysis.id, "grade", overrideGrade);
      }
      await approvePart(token, item.id);
      setItems((prev) => (prev ? prev.filter((p) => p.id !== item.id) : prev));
    } finally {
      setSubmittingId(null);
    }
  }

  /**
   * Deletes the whole vehicle behind this row -- "it was added by mistake".
   * Irreversible: the server takes the vehicle's parts, photos, AI grades
   * and the human corrections on them, so this is only ever reached through
   * the confirmation panel below, never a single click.
   */
  async function handleDeleteVehicle(item: PartListItem) {
    if (!token || !item.vehicle || deletingVehicleId) return;
    const vehicleId = item.vehicle.id;
    setDeletingVehicleId(vehicleId);
    setDeleteError(null);
    try {
      const summary = await deleteVehicle(token, vehicleId);
      // Drop every queued row for that vehicle, not just the one clicked --
      // the others now point at a vehicle that no longer exists.
      setItems((prev) => (prev ? prev.filter((p) => p.vehicle?.id !== vehicleId) : prev));
      setConfirmingPartId(null);
      setDeleteNotice(
        `Deleted ${summary.vin} — ${summary.deletedParts} ${
          summary.deletedParts === 1 ? "part" : "parts"
        } and ${summary.deletedPhotos} ${summary.deletedPhotos === 1 ? "photo" : "photos"}.`,
      );
    } catch {
      // Left open on purpose so the manager can retry without re-confirming.
      setDeleteError("Couldn't delete that vehicle. It may still be there — try again.");
    } finally {
      setDeletingVehicleId(null);
    }
  }

  // Clamped rather than stored in state: items shrinking (an approve
  // removes one) shouldn't need an effect to "fix up" a stale index --
  // just derive a valid one at read time every render.
  const clampedIndex = items && items.length > 0 ? Math.min(selectedIndex, items.length - 1) : 0;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!items || items.length === 0) return;
      // A delete confirmation is open: "a"/Enter must not approve a part
      // underneath it. Arrow keys are harmless, but moving the selection
      // while a specific row awaits confirmation is just confusing.
      if (confirmingPartId !== null) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(Math.min(clampedIndex + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(Math.max(clampedIndex - 1, 0));
      } else if (e.key === "a" || e.key === "Enter") {
        const selected = items[clampedIndex];
        if (selected) void handleApprove(selected);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleApprove closes over gradeOverrides/token/submittingId intentionally re-read fresh each render via the effect re-subscribing
  }, [items, clampedIndex, gradeOverrides, token, submittingId, confirmingPartId]);

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load the review queue.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
        <p className="font-medium">Nothing to review</p>
        <p className="text-sm text-muted-foreground">
          AI-graded parts that need a manager&apos;s eye will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Review queue</h1>

      {deleteError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {deleteError}
        </p>
      )}
      {deleteNotice && (
        <p
          role="status"
          className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
        >
          {deleteNotice}
        </p>
      )}

      <div role="listbox" aria-label="Review queue" className="grid gap-3">
        {items.map((item, index) => {
          const flagged = needsReview(item, threshold);
          const selected = index === clampedIndex;
          const currentGrade = gradeOverrides[item.id] ?? item.latestAnalysis?.grade ?? "";
          return (
            <div
              key={item.id}
              role="option"
              aria-selected={selected}
              data-testid={`review-item-${item.id}`}
              className={`rounded-xl border p-4 ${
                selected ? "border-primary ring-2 ring-primary/30" : "border-border"
              } ${flagged ? "bg-destructive/5" : ""}`}
              onClick={() => setSelectedIndex(index)}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">
                    {item.taxonomyName ?? "Part"}
                    {item.vehicle && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {[item.vehicle.year, item.vehicle.make, item.vehicle.model].filter(Boolean).join(" ")} ·{" "}
                        {item.vehicle.vin}
                      </span>
                    )}
                  </p>
                  {flagged && (
                    <p className="mt-1 inline-block rounded bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                      Needs review
                    </p>
                  )}
                  <p className="mt-2 text-sm text-muted-foreground">
                    {item.latestAnalysis?.damageCodes.length
                      ? `Damage: ${item.latestAnalysis.damageCodes.join(", ")}`
                      : "No damage codes noted"}
                    {item.latestAnalysis?.confidence != null &&
                      ` · Confidence ${Math.round(Number(item.latestAnalysis.confidence) * 100)}%`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="space-y-1">
                    <label htmlFor={`grade-${item.id}`} className="text-xs font-medium text-muted-foreground">
                      Grade
                    </label>
                    <select
                      id={`grade-${item.id}`}
                      value={currentGrade}
                      onChange={(e) =>
                        setGradeOverrides((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      className="block rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
                    >
                      <option value="" disabled>
                        —
                      </option>
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    disabled={submittingId === item.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleApprove(item);
                    }}
                  >
                    Approve
                  </Button>
                  {item.vehicle && confirmingPartId !== item.id && (
                    <Button
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setDeleteNotice(null);
                        setConfirmingPartId(item.id);
                      }}
                    >
                      Delete vehicle
                    </Button>
                  )}
                </div>
              </div>

              {item.vehicle && confirmingPartId === item.id && (
                <div
                  data-testid={`delete-confirm-${item.id}`}
                  className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="text-sm font-medium text-destructive">
                    Delete the whole vehicle {item.vehicle.vin}?
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This removes the vehicle and everything on it — every part, photo and AI
                    grade, including any not shown here, and the grade corrections recorded
                    against them.{" "}
                    {(() => {
                      // Only what's in the queue can be counted client-side;
                      // the vehicle may well have more parts than this, so
                      // the wording must not imply otherwise.
                      const queued = items.filter(
                        (p) => p.vehicle?.id === item.vehicle!.id,
                      ).length;
                      return `${queued} ${queued === 1 ? "part" : "parts"} from it ${
                        queued === 1 ? "is" : "are"
                      } in this queue.`;
                    })()}{" "}
                    This can&apos;t be undone.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="destructive"
                      disabled={deletingVehicleId === item.vehicle.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteVehicle(item);
                      }}
                    >
                      {deletingVehicleId === item.vehicle.id
                        ? "Deleting…"
                        : "Delete permanently"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingPartId(null);
                        setDeleteError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
