"use client";

import { useEffect, useState } from "react";
import { useAuthSession } from "@/lib/auth-session";
import { getAnalytics, type AnalyticsSummary } from "@/lib/api/analytics";

const GRADES = ["A", "B", "C"] as const;

function label(key: string): string {
  return key.replace(/_/g, " ");
}

function BreakdownList({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map(([key, count]) => (
        <li key={key} className="flex items-center justify-between text-sm">
          <span className="capitalize">{label(key)}</span>
          <span className="font-medium">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AnalyticsPage() {
  const token = useAuthSession((s) => s.token);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    getAnalytics(token)
      .then((s) => {
        setError(false);
        setSummary(s);
      })
      .catch(() => setError(true));
  }, [token, attempt]);

  if (error) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load analytics.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (summary === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const isEmpty = summary.totalVehicles === 0 && summary.totalParts === 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="font-medium">No data yet</p>
          <p className="text-sm text-muted-foreground">
            Numbers show up here once vehicles and parts start moving through the yard.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-6">
              <p className="text-sm text-muted-foreground">Total vehicles</p>
              <p className="mt-2 text-3xl font-semibold">{summary.totalVehicles}</p>
            </div>
            <div className="rounded-xl border border-border p-6">
              <p className="text-sm text-muted-foreground">Total parts</p>
              <p className="mt-2 text-3xl font-semibold">{summary.totalParts}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold">Parts by status</h2>
              <BreakdownList data={summary.partsByStatus} />
            </div>
            <div className="rounded-xl border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold">Grade distribution</h2>
              <ul className="flex flex-col gap-2">
                {GRADES.map((grade) => (
                  <li key={grade} data-testid={`grade-${grade}`} className="flex items-center justify-between text-sm">
                    <span>Grade {grade}</span>
                    <span className="font-medium">{summary.gradeDistribution[grade] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold">Vehicles by crush status</h2>
              <BreakdownList data={summary.vehiclesByCrushStatus} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
