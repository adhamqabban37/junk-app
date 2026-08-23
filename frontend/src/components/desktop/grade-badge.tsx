import type { VehicleGradeSummary } from "@/lib/api/vehicles";

const GRADE_STYLES: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  B: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  C: "bg-red-500/15 text-red-600 dark:text-red-400",
};

/** Small colored pill summarizing a vehicle's latest whole-vehicle AI grade. Handles all three real states: no analysis yet, still pending, and failed -- not just the happy "graded" case. */
export function GradeBadge({ grade }: { grade: VehicleGradeSummary | null }) {
  if (!grade || grade.status === "pending") {
    return (
      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        {grade ? "Grading…" : "Not graded yet"}
      </span>
    );
  }

  if (grade.status === "failed") {
    return (
      <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">
        Grading failed
      </span>
    );
  }

  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${GRADE_STYLES[grade.grade ?? ""] ?? "bg-muted text-muted-foreground"}`}
    >
      Grade {grade.grade}
    </span>
  );
}
