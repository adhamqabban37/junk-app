"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/lib/auth-session";
import { randomId } from "@/lib/random-id";
import { useIntakeStore } from "@/lib/offline/store";
import { useTaxonomyStore } from "@/lib/offline/taxonomy-store";
import type { TaxonomyItem } from "@/lib/offline/types";

export default function PartsPageClient({ draftId }: { draftId: string }) {
  const router = useRouter();
  const token = useAuthSession((s) => s.token);
  const drafts = useIntakeStore((s) => s.drafts);
  const draftsHydrated = useIntakeStore((s) => s.hydrated);
  const hydrateDrafts = useIntakeStore((s) => s.hydrate);
  const addPart = useIntakeStore((s) => s.addPart);
  const removePart = useIntakeStore((s) => s.removePart);
  const queueForSync = useIntakeStore((s) => s.queueForSync);
  const draft = drafts.find((d) => d.id === draftId);

  const taxonomyItems = useTaxonomyStore((s) => s.items);
  const taxonomyHydrated = useTaxonomyStore((s) => s.hydrated);
  const hydrateTaxonomy = useTaxonomyStore((s) => s.hydrate);
  const refreshTaxonomy = useTaxonomyStore((s) => s.refresh);

  const [query, setQuery] = useState("");
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    if (!draftsHydrated) {
      void hydrateDrafts();
    }
  }, [draftsHydrated, hydrateDrafts]);

  useEffect(() => {
    if (!taxonomyHydrated) {
      void hydrateTaxonomy();
    }
  }, [taxonomyHydrated, hydrateTaxonomy]);

  useEffect(() => {
    if (token) {
      void refreshTaxonomy(token);
    }
    // Only re-run when the token itself changes, not on every refreshTaxonomy identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /**
   * A worker who photographed the vehicle should never land on an empty
   * part list and feel obliged to tap parts out of the taxonomy by hand.
   *
   * That is exactly what happened: picking a part here creates it with no
   * photo, and the Finish gate then demands a photo for every one of them --
   * so a worker with ten perfectly good walkaround photos ended up with
   * nine empty parts and a red "still needs a photo" list. Send them to the
   * scan, which analyzes the photos they already took.
   *
   * Conditions are deliberately narrow: only when photos exist AND no parts
   * do, and only once per draft per session.
   *
   * The "once" has to outlive this component, not just this mount. A plain
   * ref would send the worker to the scan, and then send them straight back
   * the moment they returned here to pick a part by hand -- an inescapable
   * loop, since returning remounts this page with the same
   * photos-but-no-parts state that triggered it. sessionStorage is the
   * smallest thing that survives that navigation without adding a field to
   * the persisted draft model.
   */
  useEffect(() => {
    if (!draftsHydrated || !draft) return;
    if (draft.parts.length > 0) return;
    if (draft.exteriorPhotos.length === 0) return;

    const key = `intake:${draftId}:scan-offered`;
    if (typeof window === "undefined" || sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    router.replace(`/intake/${draftId}/scan`);
  }, [draftsHydrated, draft, draftId, router]);

  const addedTaxonomyIds = useMemo(
    () => new Set((draft?.parts ?? []).map((p) => p.taxonomyId)),
    [draft?.parts],
  );
  const pickable = taxonomyItems.filter((item) => !addedTaxonomyIds.has(item.id));
  const quickPicks = pickable.filter((item) => item.isQuickPick);
  const searched = query.trim()
    ? pickable.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
    : pickable;

  const parts = draft?.parts ?? [];
  const unphotographedParts = parts.filter((p) => p.photos.length === 0);
  // Every added part needs a photo before Finish, not just one anywhere in
  // the draft -- otherwise a part whose camera step failed (or was skipped)
  // syncs with zero images and sits stuck at pending_ai forever server-side,
  // since no AI job is ever queued for a part with no PartImage.
  const canFinish = parts.length > 0 && unphotographedParts.length === 0;

  async function handleSelect(item: TaxonomyItem) {
    const part = {
      id: randomId(),
      taxonomyId: item.id,
      taxonomyName: item.name,
      photos: [],
    };
    await addPart(draftId, part);
    router.push(`/intake/${draftId}/parts/${part.id}/camera`);
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      await queueForSync(draftId);
      router.push("/");
    } finally {
      setFinishing(false);
    }
  }

  if (!draft) {
    return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Select parts</h1>

      {/* Second entry point alongside picking parts by hand, not a
          replacement for it: the part-first flow below works offline, this
          one needs a connection to reach the AI. */}
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => router.push(`/intake/${draftId}/scan`)}
      >
        Scan parts from photos
      </Button>

      {draft.parts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Added</h2>
          {/* Clickable, not just a display row -- a part is added the moment
              it's picked (before any photo exists), and camera capture can
              fail (unsupported browser, permission denied). Without this,
              a part stuck at 0 photos had no way back into its camera step
              and no way to be removed, silently blocking Finish forever. */}
          <ul className="grid gap-1">
            {draft.parts.map((part) => (
              <li key={part.id} className="flex items-center gap-1">
                <Button
                  variant="outline"
                  className="flex-1 justify-between px-3 py-2 text-sm font-normal"
                  onClick={() => router.push(`/intake/${draftId}/parts/${part.id}/camera`)}
                >
                  <span>{part.taxonomyName}</span>
                  <span
                    className={
                      part.photos.length === 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {part.photos.length} photos
                  </span>
                </Button>
                {/* A mis-tapped part used to be permanent: created with no
                    photo, undeletable, and the Finish gate refuses to ship a
                    photo-less part -- so one wrong tap made the whole draft
                    unshippable. */}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${part.taxonomyName}`}
                  className="text-muted-foreground"
                  onClick={() => void removePart(draftId, part.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {quickPicks.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Quick picks</h2>
          <div className="flex flex-wrap gap-2">
            {quickPicks.map((item) => (
              <Button key={item.id} variant="secondary" onClick={() => void handleSelect(item)}>
                {item.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Input
          placeholder="Search parts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search parts"
        />
        {taxonomyHydrated && searched.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching parts.</p>
        )}
        <div className="grid gap-1">
          {searched.map((item) => (
            <Button
              key={item.id}
              variant="outline"
              className="justify-start"
              onClick={() => void handleSelect(item)}
            >
              {item.name}
              <span className="ml-auto text-xs text-muted-foreground">{item.category}</span>
            </Button>
          ))}
        </div>
      </div>

      {parts.length > 0 && unphotographedParts.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Still needs a photo: {unphotographedParts.map((p) => p.taxonomyName).join(", ")}
        </p>
      )}

      <Button
        className="w-full"
        disabled={!canFinish || finishing}
        onClick={() => void handleFinish()}
      >
        Finish &amp; queue for sync
      </Button>
    </div>
  );
}
