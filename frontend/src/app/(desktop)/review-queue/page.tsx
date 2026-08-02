"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { approvePart, listParts, type PartListItem } from "@/lib/api/parts";
import { getSettings } from "@/lib/api/settings";
import { recordCorrection } from "@/lib/api/corrections";

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

  useEffect(() => {
    if (!token) return;
    getSettings(token)
      .then((settings) => setThreshold(settings.aiConfidenceThreshold))
      .catch(() => {
        // Fall back to the built-in default (0.7) if settings can't be fetched.
      });
    listParts(token, { status: ["pending_review", "needs_manual_grading"], pageSize: 200 })
      .then((res) => setItems(res.items))
      .catch(() => setItems([]));
  }, [token]);

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

  // Clamped rather than stored in state: items shrinking (an approve
  // removes one) shouldn't need an effect to "fix up" a stale index --
  // just derive a valid one at read time every render.
  const clampedIndex = items && items.length > 0 ? Math.min(selectedIndex, items.length - 1) : 0;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!items || items.length === 0) return;
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
  }, [items, clampedIndex, gradeOverrides, token, submittingId]);

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
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
