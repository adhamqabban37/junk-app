"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { PartPhoto } from "@/components/desktop/part-photo";
import { useAuthSession } from "@/lib/auth-session";
import { recordCorrection } from "@/lib/api/corrections";
import { groupPartsByFamily } from "@/lib/inventory/part-grouping";
import { getPart, listParts, type PartDetail, type PartListItem, type PartStatus } from "@/lib/api/parts";

const GRADES = ["A", "B", "C", "D"] as const;

const STATUS_OPTIONS: { value: PartStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending_ai", label: "Pending AI" },
  { value: "pending_review", label: "Pending review" },
  { value: "needs_manual_grading", label: "Needs manual grading" },
  { value: "approved", label: "Approved" },
  { value: "listed", label: "Listed" },
  { value: "sold", label: "Sold" },
];

const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 36;
// Backend caps pageSize at 1000 (ListPartsDto); the whole point of
// virtualizing is not needing pagination on top of it for a single yard's
// inventory, so this is the ceiling rather than a "just in case" number.
const PAGE_SIZE = 1000;

function statusLabel(status: PartStatus): string {
  return status.replace(/_/g, " ");
}

/**
 * One entry in the flattened tree the virtualizer scrolls over.
 *
 * Flattened rather than nested on purpose: nesting a scroll container per
 * family would give up virtualization exactly where it matters, and a yard
 * can hold thousands of parts.
 */
type Row =
  | { kind: "header"; family: string; partIds: string[] }
  | { kind: "part"; item: PartListItem; position: string | null };

export default function InventoryPage() {
  const token = useAuthSession((s) => s.token);
  const [items, setItems] = useState<PartListItem[] | null>(null);
  const [status, setStatus] = useState<PartStatus | "">("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<PartDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [gradeDraft, setGradeDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function handleSelectRow(item: PartListItem) {
    if (!token) return;
    setSelectedId(item.id);
    setSelectedFamily(null);
    setSelectedDetail(null);
    setDetailError(false);
    getPart(token, item.id)
      .then((detail) => {
        setSelectedDetail(detail);
        setGradeDraft(detail.latestAnalysis?.grade ?? "");
      })
      .catch(() => setDetailError(true));
  }

  function handleSelectFamily(family: string) {
    // A heading selects the whole group for the photo grid but loads no
    // detail -- there is no single part to grade.
    setSelectedFamily(family);
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailError(false);
  }

  async function handleSaveGrade() {
    if (!token || !selectedDetail?.latestAnalysis || !gradeDraft) return;
    setSaving(true);
    try {
      await recordCorrection(token, selectedDetail.latestAnalysis.id, "grade", gradeDraft);
      setSelectedDetail((prev) =>
        prev && prev.latestAnalysis ? { ...prev, latestAnalysis: { ...prev.latestAnalysis, grade: gradeDraft as "A" | "B" | "C" | "D" } } : prev,
      );
      setItems((prev) =>
        prev
          ? prev.map((p) =>
              p.id === selectedDetail.id && p.latestAnalysis
                ? { ...p, latestAnalysis: { ...p.latestAnalysis, grade: gradeDraft as "A" | "B" | "C" | "D" } }
                : p,
            )
          : prev,
      );
    } finally {
      setSaving(false);
    }
  }

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

  const rows = useMemo<Row[]>(() => {
    const groups = groupPartsByFamily(items ?? [], (p) => p.taxonomyName);
    const flat: Row[] = [];
    for (const group of groups) {
      if (group.isSection) {
        flat.push({
          kind: "header",
          family: group.family,
          partIds: group.entries.map((e) => e.item.id),
        });
      }
      for (const entry of group.entries) {
        flat.push({ kind: "part", item: entry.item, position: entry.position });
      }
    }
    return flat;
  }, [items]);

  /** Photos for whatever is selected: one part, a whole family, or nothing. */
  const gridPhotos = useMemo(() => {
    if (!items) return [];
    const source = selectedId
      ? items.filter((p) => p.id === selectedId)
      : selectedFamily
        ? items.filter((p) => {
            const header = rows.find(
              (r): r is Extract<Row, { kind: "header" }> =>
                r.kind === "header" && r.family === selectedFamily,
            );
            return header?.partIds.includes(p.id) ?? false;
          })
        : [];
    return source.flatMap((p) => p.photoIds.map((imageId) => ({ partId: p.id, imageId })));
  }, [items, rows, selectedId, selectedFamily]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div role="table" aria-label="Inventory" className="rounded-xl border border-border">
            <div role="row" className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr_0.5fr] gap-4 border-b border-border px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <span role="columnheader">Part</span>
              <span role="columnheader">Vehicle</span>
              <span role="columnheader">VIN</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Grade</span>
            </div>
            <div ref={scrollRef} data-testid="inventory-scroll-container" className="max-h-[600px] overflow-auto">
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const style = {
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  } as const;

                  if (row.kind === "header") {
                    return (
                      <button
                        key={`header-${row.family}`}
                        type="button"
                        role="rowheader"
                        aria-selected={row.family === selectedFamily}
                        className={`absolute left-0 top-0 flex w-full items-center gap-2 border-b border-border px-4 text-left text-xs font-semibold uppercase tracking-wide ${
                          row.family === selectedFamily ? "bg-primary/10 text-foreground" : "bg-muted/40 text-muted-foreground"
                        }`}
                        style={style}
                        onClick={() => handleSelectFamily(row.family)}
                      >
                        <span>{row.family}</span>
                        <span className="font-normal normal-case opacity-70">
                          {row.partIds.length}
                        </span>
                      </button>
                    );
                  }

                  const { item, position } = row;
                  return (
                    <div
                      key={item.id}
                      role="row"
                      aria-selected={item.id === selectedId}
                      data-testid={`inventory-row-${item.id}`}
                      className={`absolute left-0 top-0 grid w-full cursor-pointer grid-cols-[1.5fr_1fr_1.5fr_1fr_0.5fr] items-center gap-4 border-b px-4 text-sm hover:bg-muted/50 ${
                        item.id === selectedId ? "border-primary bg-muted/50" : "border-border"
                      }`}
                      style={style}
                      onClick={() => handleSelectRow(item)}
                    >
                      <span role="cell" className={position ? "pl-3" : undefined}>
                        {position ? (
                          <span data-testid={`inventory-position-${item.id}`}>{position}</span>
                        ) : (
                          (item.taxonomyName ?? "Part")
                        )}
                      </span>
                      <span role="cell">
                        {item.vehicle
                          ? [item.vehicle.year, item.vehicle.make, item.vehicle.model].filter(Boolean).join(" ")
                          : "—"}
                      </span>
                      <span role="cell">{item.vehicle?.vin ?? "—"}</span>
                      <span role="cell" className="capitalize">
                        {statusLabel(item.status)}
                      </span>
                      <span role="cell">{item.latestAnalysis?.grade ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">
              {selectedFamily ?? (selectedDetail?.taxonomyName ?? "Photos")}
            </h2>
            {gridPhotos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Select a part or a group to see its photos.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {gridPhotos.map(({ partId, imageId }) => (
                  <PartPhoto key={imageId} token={token!} partId={partId} imageId={imageId} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedId && (
        <div className="rounded-xl border border-border p-4">
          {detailError ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
              <span>Couldn&apos;t load this part&apos;s details.</span>
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  const row = rows.find(
                    (r): r is Extract<Row, { kind: "part" }> =>
                      r.kind === "part" && r.item.id === selectedId,
                  );
                  if (row) handleSelectRow(row.item);
                }}
              >
                Retry
              </button>
            </div>
          ) : !selectedDetail ? (
            <p className="text-sm text-muted-foreground">Loading part details…</p>
          ) : (
            <div className="flex flex-col gap-4">
              <h2 className="font-semibold">{selectedDetail.taxonomyName ?? "Part"}</h2>

              {!selectedDetail.latestAnalysis ? (
                <p className="text-sm text-muted-foreground">No AI analysis yet — grade can&apos;t be edited.</p>
              ) : (
                <div className="flex items-end gap-3">
                  <div className="space-y-1">
                    <label htmlFor="inventory-grade" className="text-xs font-medium text-muted-foreground">
                      Grade
                    </label>
                    <select
                      id="inventory-grade"
                      value={gradeDraft}
                      onChange={(e) => setGradeDraft(e.target.value)}
                      className="block rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
                    >
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    disabled={saving || gradeDraft === (selectedDetail.latestAnalysis.grade ?? "")}
                    onClick={() => void handleSaveGrade()}
                  >
                    Save grade
                  </Button>
                  {selectedDetail.latestAnalysis.damageCodes.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Damage: {selectedDetail.latestAnalysis.damageCodes.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
