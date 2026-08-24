const PART_GRADE_STYLES: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  B: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  C: "bg-red-500/15 text-red-600 dark:text-red-400",
  X: "bg-muted text-muted-foreground",
};

function formatDamageUnits(units: number | string | null | undefined): string | undefined {
  if (units == null) return undefined;
  return `${Number(units).toFixed(2)} damage units`;
}

/**
 * Shared per-part grade pill -- A/B/C colored like the vehicle-level
 * GradeBadge, plus the ARA-style "X" (ungraded/insufficient information)
 * state that only ever comes from a sheet-metal part's AI analysis (see
 * backend/src/ai/grading.service.ts). Shows the damage-unit total in a
 * title tooltip when present (sheet-metal parts only -- null otherwise).
 */
export function PartGradeBadge({
  grade,
  damageUnits,
}: {
  grade: string | null | undefined;
  damageUnits?: number | string | null;
}) {
  if (!grade) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      title={formatDamageUnits(damageUnits)}
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PART_GRADE_STYLES[grade] ?? "bg-muted text-muted-foreground"}`}
    >
      {grade === "X" ? "Ungraded" : `Grade ${grade}`}
    </span>
  );
}
