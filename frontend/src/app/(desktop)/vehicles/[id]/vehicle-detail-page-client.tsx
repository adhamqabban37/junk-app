"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/lib/auth-session";
import { fetchTaxonomy, type TaxonomyItemResponse } from "@/lib/api";
import { getVehicle, type VehicleDetail } from "@/lib/api/vehicles";
import {
  assignVehiclePhotos,
  fetchVehiclePhotoBlob,
  listVehiclePhotos,
  type VehiclePhotoSummary,
} from "@/lib/api/vehicle-photos";
import { listParts, approvePart, type PartListItem } from "@/lib/api/parts";
import { VehiclePhotoThumb } from "@/components/desktop/vehicle-photo-thumb";
import { GradeBadge } from "@/components/desktop/grade-badge";
import { PartGradeBadge } from "@/components/desktop/part-grade-badge";

/** Per-part AI grade card: shows the taxonomy name, grade/damage/confidence once analysis completes, and an Approve action -- this is the "what did AI rate each part, so I can approve or not" view that was missing (the old Parts section only showed a bare status word). Re-grade lives on the Inventory tab instead, not here -- deliberate, per the user's own call. */
function PartCard({ part, onApprove, approving }: { part: PartListItem; onApprove: () => void; approving: boolean }) {
  const analysis = part.latestAnalysis;
  const alreadyDecided = part.status === "approved" || part.status === "listed" || part.status === "sold";

  return (
    <li data-testid={`part-row-${part.id}`} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{part.taxonomyName ?? "Unknown part"}</p>
        {alreadyDecided && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
            {part.status}
          </span>
        )}
      </div>

      {!analysis || analysis.status === "pending" ? (
        <p className="text-xs text-muted-foreground">Grading in progress…</p>
      ) : analysis.status === "failed" ? (
        <p className="text-xs text-destructive">AI grading failed — needs manual grading in the Review Queue.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <PartGradeBadge grade={analysis.grade} damageUnits={analysis.damageUnits} />
            {analysis.confidence != null && (
              <span className="text-xs text-muted-foreground">{Math.round(Number(analysis.confidence) * 100)}% confidence</span>
            )}
          </div>
          {analysis.damageCodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {analysis.damageCodes.map((code) => (
                <span key={code} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {code}
                </span>
              ))}
            </div>
          )}
          {!alreadyDecided && analysis.grade !== "X" && (
            <Button type="button" size="sm" variant="outline" disabled={approving} onClick={onApprove}>
              {approving ? "Approving…" : "Approve"}
            </Button>
          )}
        </>
      )}
    </li>
  );
}

function vehicleTitle(vehicle: VehicleDetail): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Unknown vehicle";
}

/** Opens the full-size photo in a new tab -- fetched as an authenticated blob since the file route is JWT-guarded, so a plain anchor href can't reach it directly. */
async function openFullSize(token: string, vehicleId: string, photoId: string) {
  const blob = await fetchVehiclePhotoBlob(token, vehicleId, photoId);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Revoked lazily -- the new tab has already grabbed the resource by the
  // time this fires, and holding onto it longer than a few seconds has no
  // benefit.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function GradeCard({ vehicle }: { vehicle: VehicleDetail }) {
  const analysis = vehicle.latestVehicleAnalysis;

  if (!analysis) {
    return (
      <div className="rounded-xl border border-border p-4">
        <p className="text-sm text-muted-foreground">
          Not graded yet. A grade appears automatically once the vehicle has at least one photo.
        </p>
      </div>
    );
  }

  if (analysis.status === "pending") {
    return (
      <div className="rounded-xl border border-border p-4">
        <p className="text-sm text-muted-foreground">Grading in progress… refresh in a moment.</p>
      </div>
    );
  }

  if (analysis.status === "failed") {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        AI grading failed for this vehicle. It can be graded manually via the parts below.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
      <GradeBadge grade={{ grade: analysis.grade, status: analysis.status, photoCount: analysis.photoCount }} />
      <p className="text-sm text-muted-foreground">
        Graded from {analysis.photoCount} photo{analysis.photoCount === 1 ? "" : "s"}
        {analysis.confidence != null ? ` · ${Math.round(Number(analysis.confidence) * 100)}% confidence` : ""}
      </p>
      {analysis.damageCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {analysis.damageCodes.map((code) => (
            <span key={code} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {code}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VehicleDetailPageClient({ vehicleId }: { vehicleId: string }) {
  const token = useAuthSession((s) => s.token);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [photos, setPhotos] = useState<VehiclePhotoSummary[] | null>(null);
  const [parts, setParts] = useState<PartListItem[] | null>(null);
  const [taxonomies, setTaxonomies] = useState<TaxonomyItemResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [approvingPartId, setApprovingPartId] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [taxonomyQuery, setTaxonomyQuery] = useState("");
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Photos assigned to at least one part this session -- the backend keeps
  // the photo around after assigning (a single photo can show more than one
  // part, e.g. bumper + headlight in the same frame), so this is purely a
  // "you've used this one before" hint, not a removal.
  const [assignedPhotoIds, setAssignedPhotoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([
      getVehicle(token, vehicleId),
      listVehiclePhotos(token, vehicleId),
      fetchTaxonomy(token),
      listParts(token, { vehicleId, pageSize: 200 }),
    ])
      .then(([v, p, t, partsRes]) => {
        if (cancelled) return;
        setError(false);
        setVehicle(v);
        setPhotos(p);
        setTaxonomies(t);
        setParts(partsRes.items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, vehicleId, attempt]);

  async function handleApprovePart(partId: string) {
    if (!token || approvingPartId) return;
    setApprovingPartId(partId);
    try {
      await approvePart(token, partId);
      setParts((prev) =>
        prev ? prev.map((p) => (p.id === partId ? { ...p, status: "approved" } : p)) : prev,
      );
    } finally {
      setApprovingPartId(null);
    }
  }

  function togglePhoto(id: string) {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // Pre-fill the taxonomy from the AI's highest-confidence suggestion
      // (a photo can have several now -- headlight + bumper + fender all
      // in one frame), but only when the selection is unambiguous (exactly
      // one photo) -- a manager can still always override by picking a
      // different part below.
      if (next.size === 1) {
        const [onlyId] = next;
        const suggestions = photos?.find((p) => p.id === onlyId)?.suggestions ?? [];
        const top = suggestions.reduce<(typeof suggestions)[number] | null>(
          (best, s) => (!best || Number(s.confidence) > Number(best.confidence) ? s : best),
          null,
        );
        if (top) setSelectedTaxonomyId(top.taxonomyId);
      }
      return next;
    });
  }

  async function handleAssign() {
    if (!token || !selectedTaxonomyId || selectedPhotoIds.size === 0) return;
    setAssigning(true);
    try {
      await assignVehiclePhotos(token, vehicleId, [...selectedPhotoIds], selectedTaxonomyId);
      // Photos stay in the grid -- the same photo can be assigned again to
      // a different part (e.g. it also shows the headlight). Just mark
      // them as "used" and refresh the vehicle so the new part shows up.
      setAssignedPhotoIds((prev) => new Set([...prev, ...selectedPhotoIds]));
      setSelectedPhotoIds(new Set());
      setSelectedTaxonomyId(null);
      setAttempt((n) => n + 1);
    } finally {
      setAssigning(false);
    }
  }

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load this vehicle.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!vehicle || !photos || !taxonomies || !parts) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const quickPicks = taxonomies.filter((t) => t.isQuickPick);
  const shownTaxonomies = taxonomyQuery
    ? taxonomies.filter((t) => t.name.toLowerCase().includes(taxonomyQuery.toLowerCase()))
    : quickPicks;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{vehicleTitle(vehicle)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vehicle.vin} · <span className="capitalize">{vehicle.crushStatus}</span> · {vehicle.partsCount} part
            {vehicle.partsCount === 1 ? "" : "s"} catalogued
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Refresh
        </Button>
      </div>

      <GradeCard vehicle={vehicle} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Parts ({parts.length})</h2>
        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts catalogued yet -- assign photos to a part below.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {parts.map((part) => (
              <PartCard
                key={part.id}
                part={part}
                approving={approvingPartId === part.id}
                onApprove={() => void handleApprovePart(part.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Photos</h2>
          <span className="text-sm text-muted-foreground">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          A photo can be assigned to more than one part if it shows several (e.g. a bumper photo that also catches
          the headlight) -- select it again and pick a different part.
        </p>

        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No photos yet. Photos synced from the worker&apos;s intake show up here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {photos.map((photo) => (
                <div key={photo.id} className="flex flex-col gap-1.5">
                  <div className="relative">
                    <VehiclePhotoThumb
                      token={token as string}
                      vehicleId={vehicleId}
                      photoId={photo.id}
                      selected={selectedPhotoIds.has(photo.id)}
                      onToggle={() => togglePhoto(photo.id)}
                      className="aspect-square"
                    />
                    {assignedPhotoIds.has(photo.id) && (
                      <span className="absolute right-1 top-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                        Used
                      </span>
                    )}
                  </div>
                  {photo.suggestions.length > 0 && (
                    <div className="space-y-0.5">
                      {photo.suggestions.map((s) => (
                        <p
                          key={s.taxonomyId}
                          className="truncate text-xs text-muted-foreground"
                          title={`Suggested: ${s.taxonomyName ?? "Unknown part"} (${Math.round(Number(s.confidence) * 100)}%)`}
                        >
                          Suggested: {s.taxonomyName ?? "Unknown part"} ({Math.round(Number(s.confidence) * 100)}%)
                        </p>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline hover:text-foreground"
                    onClick={() => void openFullSize(token as string, vehicleId, photo.id)}
                  >
                    View full size
                  </button>
                </div>
              ))}
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">Assign to a part</p>
                <p className="text-xs text-muted-foreground">
                  Optional -- only needed to catalog a specific part for the marketplace. Grading above already
                  happens automatically from every photo on this vehicle.
                </p>
              </div>
              <p className="text-sm font-medium">{selectedPhotoIds.size} photo(s) selected</p>
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
              <Button
                type="button"
                className="w-full"
                disabled={selectedPhotoIds.size === 0 || !selectedTaxonomyId || assigning}
                onClick={() => void handleAssign()}
              >
                Assign {selectedPhotoIds.size} photo(s)
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
