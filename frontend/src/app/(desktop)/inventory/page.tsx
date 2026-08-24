"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthSession } from "@/lib/auth-session";
import { listParts, setPartPrice, type PartListItem, type PartStatus } from "@/lib/api/parts";
import { PartGradeBadge } from "@/components/desktop/part-grade-badge";

const STATUS_OPTIONS: { value: PartStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending_ai", label: "Pending AI" },
  { value: "pending_review", label: "Pending review" },
  { value: "needs_manual_grading", label: "Needs manual grading" },
  { value: "approved", label: "Approved" },
  { value: "listed", label: "Listed" },
  { value: "sold", label: "Sold" },
];

const ROW_HEIGHT = 64;
// Backend caps pageSize at 1000 (ListPartsDto); the whole point of
// virtualizing is not needing pagination on top of it for a single yard's
// inventory, so this is the ceiling rather than a "just in case" number.
const PAGE_SIZE = 1000;

function statusLabel(status: PartStatus): string {
  return status.replace(/_/g, " ");
}

function formatPrice(price: string | null): string {
  return price == null ? "—" : `$${Number(price).toFixed(2)}`;
}

export default function InventoryPage() {
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<PartListItem[] | null>(null);
  const [status, setStatus] = useState<PartStatus | "">("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listParts(token, { status: status ? [status] : undefined, pageSize: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setError(false);
        setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, status, attempt]);

  function startEditPrice(item: PartListItem) {
    setEditingPriceId(item.id);
    setPriceDraft(item.latestPrice ?? "");
  }

  async function handleSavePrice(id: string) {
    if (!token || savingPriceId) return;
    const price = Number(priceDraft);
    if (!Number.isFinite(price) || price < 0) return;
    setSavingPriceId(id);
    try {
      await setPartPrice(token, id, price);
      setItems((prev) =>
        prev ? prev.map((p) => (p.id === id ? { ...p, latestPrice: price.toFixed(2) } : p)) : prev,
      );
      setEditingPriceId(null);
    } finally {
      setSavingPriceId(null);
    }
  }

  const rows = useMemo(() => items ?? [], [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load inventory.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (items === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="inventory-status" className="text-sm font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="inventory-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as PartStatus | "")}
            className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="font-medium">No parts in inventory</p>
          <p className="text-sm text-muted-foreground">
            Parts show up here once they&apos;ve been intaken from the yard floor.
          </p>
        </div>
      ) : (
        <div role="table" aria-label="Inventory" className="rounded-xl border border-border">
          <div role="row" className="grid grid-cols-6 gap-4 border-b border-border px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
            <span role="columnheader">Part</span>
            <span role="columnheader">Vehicle</span>
            <span role="columnheader">VIN</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Grade</span>
            <span role="columnheader">Price</span>
          </div>
          <div ref={scrollRef} data-testid="inventory-scroll-container" className="max-h-[600px] overflow-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = rows[virtualRow.index];
                const isEditingPrice = editingPriceId === item.id;
                return (
                  <div
                    key={item.id}
                    role="row"
                    data-testid={`inventory-row-${item.id}`}
                    className="absolute left-0 top-0 grid w-full grid-cols-6 items-center gap-4 border-b border-border px-4 text-sm"
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <span role="cell">{item.taxonomyName ?? "Part"}</span>
                    <span role="cell">
                      {item.vehicle
                        ? [item.vehicle.year, item.vehicle.make, item.vehicle.model].filter(Boolean).join(" ")
                        : "—"}
                    </span>
                    <span role="cell">{item.vehicle?.vin ?? "—"}</span>
                    <span role="cell" className="capitalize">
                      {statusLabel(item.status)}
                    </span>
                    <span role="cell">
                      <PartGradeBadge
                        grade={item.latestAnalysis?.grade}
                        damageUnits={item.latestAnalysis?.damageUnits}
                      />
                    </span>
                    <span role="cell">
                      {isEditingPrice ? (
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={`Price for ${item.taxonomyName ?? "part"}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceDraft}
                            onChange={(e) => setPriceDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleSavePrice(item.id);
                              if (e.key === "Escape") setEditingPriceId(null);
                            }}
                            className="h-8 w-20 px-2 text-sm"
                            autoFocus
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={savingPriceId === item.id}
                            onClick={() => void handleSavePrice(item.id)}
                          >
                            {savingPriceId === item.id ? "…" : "Save"}
                          </Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => startEditPrice(item)}
                        >
                          {formatPrice(item.latestPrice)}
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
