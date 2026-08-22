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

function vehicleTitle(vehicle: VehicleDetail): string {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || "Unknown vehicle";
}

/** Fetches its own photo as an authenticated blob (the file route is JWT-guarded, so a plain <img src> can't reach it) and manages the resulting object URL's lifecycle. */
function VehiclePhotoThumb({
  token,
  vehicleId,
  photo,
  selected,
  onToggle,
}: {
  token: string;
  vehicleId: string;
  photo: VehiclePhotoSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    fetchVehiclePhotoBlob(token, vehicleId, photo.id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => {
        // Thumbnail just stays a placeholder -- not worth a page-level error.
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, vehicleId, photo.id]);

  return (
    <button
      type="button"
      data-testid={`unassigned-photo-${photo.id}`}
      aria-pressed={selected}
      onClick={onToggle}
      className={`aspect-square overflow-hidden rounded-lg border-2 ${
        selected ? "border-primary ring-2 ring-primary/30" : "border-border"
      }`}
    >
      {objectUrl ? (
        // Blob object URLs aren't a fit for next/image's remote-image
        // pipeline -- a plain <img> is the documented approach here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={objectUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          Loading…
        </span>
      )}
    </button>
  );
}

export default function VehicleDetailPageClient({ vehicleId }: { vehicleId: string }) {
  const token = useAuthSession((s) => s.token);
  const [vehicle, setVehicle] = useState<VehicleDetail | null>(null);
  const [photos, setPhotos] = useState<VehiclePhotoSummary[] | null>(null);
  const [taxonomies, setTaxonomies] = useState<TaxonomyItemResponse[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [taxonomyQuery, setTaxonomyQuery] = useState("");
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([getVehicle(token, vehicleId), listVehiclePhotos(token, vehicleId), fetchTaxonomy(token)])
      .then(([v, p, t]) => {
        if (cancelled) return;
        setError(false);
        setVehicle(v);
        setPhotos(p);
        setTaxonomies(t);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, vehicleId, attempt]);

  function togglePhoto(id: string) {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleAssign() {
    if (!token || !selectedTaxonomyId || selectedPhotoIds.size === 0) return;
    setAssigning(true);
    try {
      await assignVehiclePhotos(token, vehicleId, [...selectedPhotoIds], selectedTaxonomyId);
      setPhotos((prev) => (prev ? prev.filter((p) => !selectedPhotoIds.has(p.id)) : prev));
      setSelectedPhotoIds(new Set());
      setSelectedTaxonomyId(null);
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

  if (!vehicle || !photos || !taxonomies) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const quickPicks = taxonomies.filter((t) => t.isQuickPick);
  const shownTaxonomies = taxonomyQuery
    ? taxonomies.filter((t) => t.name.toLowerCase().includes(taxonomyQuery.toLowerCase()))
    : quickPicks;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{vehicleTitle(vehicle)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vehicle.vin} · <span className="capitalize">{vehicle.crushStatus}</span>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Parts</h2>
        {vehicle.parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts yet.</p>
        ) : (
          <ul className="grid gap-2">
            {vehicle.parts.map((part) => (
              <li
                key={part.id}
                data-testid={`part-row-${part.id}`}
                className="rounded-lg border border-border p-3 text-sm capitalize"
              >
                {part.status.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Unassigned photos</h2>
          <span className="text-sm text-muted-foreground">{photos.length}</span>
        </div>

        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No unassigned photos. Photos synced from the worker&apos;s intake show up here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {photos.map((photo) => (
                <VehiclePhotoThumb
                  key={photo.id}
                  token={token as string}
                  vehicleId={vehicleId}
                  photo={photo}
                  selected={selectedPhotoIds.has(photo.id)}
                  onToggle={() => togglePhoto(photo.id)}
                />
              ))}
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
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
