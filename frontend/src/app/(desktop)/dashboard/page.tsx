"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/lib/auth-session";
import { listParts } from "@/lib/api/parts";
import { listVehicles } from "@/lib/api/vehicles";

interface StatCardProps {
  label: string;
  value: number | null;
  href?: string;
}

function StatCard({ label, value, href }: StatCardProps) {
  const content = (
    <div className="rounded-xl border border-border p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value === null ? "…" : value}</p>
    </div>
  );
  return href ? (
    <Link href={href} aria-label={label} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function DashboardPage() {
  const token = useAuthSession((s) => s.token);
  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [marketplaceReadyCount, setMarketplaceReadyCount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    // A stat failing to load must not silently render as "0" -- that's
    // indistinguishable from a genuinely empty yard. All three requests
    // share one error banner since they're one logical "load the dashboard"
    // operation from the manager's point of view.
    Promise.all([
      listVehicles(token, { pageSize: 1 }).then((res) => res.total),
      listParts(token, { status: ["pending_review", "needs_manual_grading"], pageSize: 1 }).then(
        (res) => res.total,
      ),
      listParts(token, { status: ["approved", "listed"], pageSize: 1 }).then((res) => res.total),
    ])
      .then(([vehicles, review, marketplaceReady]) => {
        if (cancelled) return;
        setError(false);
        setVehicleCount(vehicles);
        setReviewCount(review);
        setMarketplaceReadyCount(marketplaceReady);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {error ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span>Couldn&apos;t load dashboard data.</span>
          <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Vehicles in yard" value={vehicleCount} href="/vehicles" />
          <StatCard label="Needs review" value={reviewCount} href="/review-queue" />
          <StatCard label="Marketplace-ready parts" value={marketplaceReadyCount} href="/inventory" />
        </div>
      )}
    </div>
  );
}
