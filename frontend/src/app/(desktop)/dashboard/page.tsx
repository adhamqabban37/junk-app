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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    listVehicles(token, { pageSize: 1 })
      .then((res) => {
        if (!cancelled) setVehicleCount(res.total);
      })
      .catch(() => {
        if (!cancelled) setVehicleCount(0);
      });

    listParts(token, { status: ["pending_review", "needs_manual_grading"], pageSize: 1 })
      .then((res) => {
        if (!cancelled) setReviewCount(res.total);
      })
      .catch(() => {
        if (!cancelled) setReviewCount(0);
      });

    listParts(token, { status: ["approved", "listed"], pageSize: 1 })
      .then((res) => {
        if (!cancelled) setMarketplaceReadyCount(res.total);
      })
      .catch(() => {
        if (!cancelled) setMarketplaceReadyCount(0);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Vehicles in yard" value={vehicleCount} href="/vehicles" />
        <StatCard label="Needs review" value={reviewCount} href="/review-queue" />
        <StatCard label="Marketplace-ready parts" value={marketplaceReadyCount} href="/inventory" />
      </div>
    </div>
  );
}
