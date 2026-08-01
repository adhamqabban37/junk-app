"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/lib/auth-session";
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

  const addedTaxonomyIds = useMemo(
    () => new Set((draft?.parts ?? []).map((p) => p.taxonomyId)),
    [draft?.parts],
  );
  const pickable = taxonomyItems.filter((item) => !addedTaxonomyIds.has(item.id));
  const quickPicks = pickable.filter((item) => item.isQuickPick);
  const searched = query.trim()
    ? pickable.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
    : pickable;

  const hasPhotographedPart = (draft?.parts ?? []).some((p) => p.photos.length > 0);

  async function handleSelect(item: TaxonomyItem) {
    const part = {
      id: crypto.randomUUID(),
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

      {draft.parts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Added</h2>
          <ul className="grid gap-1">
            {draft.parts.map((part) => (
              <li
                key={part.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>{part.taxonomyName}</span>
                <span className="text-muted-foreground">{part.photos.length} photos</span>
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

      <Button
        className="w-full"
        disabled={!hasPhotographedPart || finishing}
        onClick={() => void handleFinish()}
      >
        Finish &amp; queue for sync
      </Button>
    </div>
  );
}
