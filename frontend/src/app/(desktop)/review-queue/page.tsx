"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/lib/auth-session";
import { approvePart, listParts, mergeParts, regradePart, type PartListItem } from "@/lib/api/parts";
import { getSettings } from "@/lib/api/settings";
import { recordCorrection } from "@/lib/api/corrections";
import { fetchTaxonomy, type TaxonomyItemResponse } from "@/lib/api";
import { createManualPart, listVehicles, type VehicleListItem } from "@/lib/api/vehicles";
import { PartImageThumb } from "@/components/desktop/part-image-thumb";

const GRADES = ["A", "B", "C", "X"] as const;

function needsReview(item: PartListItem, threshold: number): boolean {
  const analysis = item.latestAnalysis;
  if (!analysis || analysis.status !== "complete") return true;
  // X ("insufficient information") always needs a human look -- that's the
  // whole point of the state, regardless of the confidence Gemini reported
  // alongside it.
  if (analysis.grade === "X") return true;
  if (analysis.confidence === null) return true;
  return Number(analysis.confidence) < threshold;
}

function vehicleLabel(v: VehicleListItem): string {
  return `${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Unknown vehicle"} · ${v.vin}`;
}

/**
 * Manually adds a Part with no photo -- e.g. an alternator inside an
 * unphotographed engine bay. Vehicle + taxonomy pick, mirroring the same
 * search-then-pick pattern already used for photo assignment on the
 * vehicle detail page.
 */
function AddPartPanel({ token, onAdded }: { token: string; onAdded: () => void }) {
  const [vehicles, setVehicles] = useState<VehicleListItem[] | null>(null);
  const [taxonomies, setTaxonomies] = useState<TaxonomyItemResponse[] | null>(null);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [taxonomyQuery, setTaxonomyQuery] = useState("");
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    listVehicles(token, { pageSize: 200 })
      .then((res) => setVehicles(res.items))
      .catch(() => setVehicles([]));
    fetchTaxonomy(token)
      .then(setTaxonomies)
      .catch(() => setTaxonomies([]));
  }, [token]);

  const matchingVehicles = (vehicles ?? [])
    .filter((v) => (vehicleQuery ? vehicleLabel(v).toLowerCase().includes(vehicleQuery.toLowerCase()) : true))
    .slice(0, 20);

  const quickPicks = (taxonomies ?? []).filter((t) => t.isQuickPick);
  const shownTaxonomies = taxonomyQuery
    ? (taxonomies ?? []).filter((t) => t.name.toLowerCase().includes(taxonomyQuery.toLowerCase()))
    : quickPicks;

  async function handleSubmit() {
    if (!token || !selectedVehicleId || !selectedTaxonomyId || submitting) return;
    setSubmitting(true);
    try {
      await createManualPart(token, selectedVehicleId, selectedTaxonomyId);
      setSelectedVehicleId(null);
      setSelectedTaxonomyId(null);
      setVehicleQuery("");
      setTaxonomyQuery("");
      onAdded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div>
        <p className="text-sm font-medium">Add a part</p>
        <p className="text-xs text-muted-foreground">
          For a part that isn&apos;t in any photo -- e.g. an alternator inside the engine. It lands here with no
          grade prefilled since there&apos;s nothing to override.
        </p>
      </div>

      <div className="space-y-2">
        <Input
          aria-label="Search vehicles"
          placeholder="Search vehicles by VIN, make, model…"
          value={vehicleQuery}
          onChange={(e) => setVehicleQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {matchingVehicles.map((v) => (
            <Button
              key={v.id}
              type="button"
              variant={selectedVehicleId === v.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedVehicleId(v.id)}
            >
              {vehicleLabel(v)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Input
          aria-label="Search taxonomy"
          placeholder="Search parts…"
          value={taxonomyQuery}
          onChange={(e) => setTaxonomyQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {shownTaxonomies.map((t) => (
            <Button
              key={t.id}
              type="button"
              variant={selectedTaxonomyId === t.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedTaxonomyId(t.id)}
            >
              {t.name}
            </Button>
          ))}
        </div>
      </div>

      <Button
        type="button"
        className="w-full"
        disabled={!selectedVehicleId || !selectedTaxonomyId || submitting}
        onClick={() => void handleSubmit()}
      >
        {submitting ? "Adding…" : "Add part"}
      </Button>
    </div>
  );
}

export default function ReviewQueuePage() {
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<PartListItem[] | null>(null);
  const [threshold, setThreshold] = useState(0.7);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [gradeOverrides, setGradeOverrides] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [regradingId, setRegradingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showAddPart, setShowAddPart] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);

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

  async function handleRegrade(item: PartListItem) {
    if (!token || regradingId) return;
    setRegradingId(item.id);
    try {
      await regradePart(token, item.id);
    } finally {
      setRegradingId(null);
    }
  }

  function toggleMergeMode() {
    setMergeMode((v) => !v);
    setSelectedForMerge(new Set());
  }

  function toggleMergeSelection(id: string) {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedMergeItems = (items ?? []).filter((p) => selectedForMerge.has(p.id));
  const mergeVehicleIds = new Set(selectedMergeItems.map((p) => p.vehicle?.id ?? null));
  const mergeSpansVehicles = mergeVehicleIds.size > 1;

  async function handleMerge() {
    if (!token || merging || selectedMergeItems.length < 2 || mergeSpansVehicles) return;
    setMerging(true);
    try {
      // Deterministic target so there's nothing extra to pick: the
      // earliest-created selected Part is treated as "the original,"
      // everything else selected folds into it.
      const sorted = [...selectedMergeItems].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const [target, ...sources] = sorted;
      await mergeParts(token, target.id, sources.map((p) => p.id));
      setMergeMode(false);
      setSelectedForMerge(new Set());
      setAttempt((n) => n + 1);
    } finally {
      setMerging(false);
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

  let content: React.ReactNode;
  if (error) {
    content = (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load the review queue.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  } else if (items === null) {
    content = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (items.length === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
        <p className="font-medium">Nothing to review</p>
        <p className="text-sm text-muted-foreground">
          AI-graded parts that need a manager&apos;s eye will show up here.
        </p>
      </div>
    );
  } else {
    content = (
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
                <div className="flex items-start gap-3">
                  {mergeMode && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.taxonomyName ?? "part"} for merge`}
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={selectedForMerge.has(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleMergeSelection(item.id)}
                    />
                  )}
                  {item.firstImageId && token && (
                    <PartImageThumb
                      token={token}
                      partId={item.id}
                      imageId={item.firstImageId}
                      className="h-16 w-16 shrink-0"
                    />
                  )}
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
                      {item.latestAnalysis?.damageUnits != null &&
                        ` · ${Number(item.latestAnalysis.damageUnits).toFixed(2)} damage units`}
                    </p>
                  </div>
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
                  {item.photosCount > 0 && (
                    <Button
                      variant="outline"
                      disabled={regradingId === item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRegrade(item);
                      }}
                    >
                      {regradingId === item.id ? "Re-grading…" : "Re-grade"}
                    </Button>
                  )}
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
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={toggleMergeMode}>
            {mergeMode ? "Cancel merge" : "Merge duplicates"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAddPart((v) => !v)}>
            {showAddPart ? "Cancel" : "Add a part"}
          </Button>
        </div>
      </div>
      {showAddPart && (
        <AddPartPanel
          token={token ?? ""}
          onAdded={() => {
            setShowAddPart(false);
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {mergeMode && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">
              {selectedForMerge.size === 0
                ? "Select two or more parts that are really the same physical part."
                : `${selectedForMerge.size} selected`}
            </p>
            {mergeSpansVehicles && (
              <p className="text-xs text-destructive">
                Selected parts must all belong to the same vehicle.
              </p>
            )}
          </div>
          <Button
            type="button"
            disabled={selectedForMerge.size < 2 || mergeSpansVehicles || merging}
            onClick={() => void handleMerge()}
          >
            {merging ? "Merging…" : `Merge ${selectedForMerge.size || ""} parts`}
          </Button>
        </div>
      )}
      {content}
    </div>
  );
}
