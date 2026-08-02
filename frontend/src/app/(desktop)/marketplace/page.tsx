"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { listParts, exportPartsCsvUrl } from "@/lib/api/parts";

export default function MarketplacePage() {
  const token = useAuthSession((s) => s.token);
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    listParts(token, { status: ["approved", "listed"], pageSize: 1 })
      .then((res) => {
        setCountError(false);
        setReadyCount(res.total);
      })
      .catch(() => setCountError(true));
  }, [token]);

  async function handleExport() {
    if (!token || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const blob = await exportPartsCsvUrl(token);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `marketplace-export-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't export the CSV. Try again in a moment.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Marketplace syndication</h1>
      <div className="rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Marketplace-ready parts</p>
        {countError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Couldn&apos;t load the marketplace-ready count.
          </p>
        ) : (
          <p className="mt-2 text-3xl font-semibold">{readyCount === null ? "…" : readyCount}</p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Approved and listed parts, exported as a CSV for manual upload to eBay, Shopify, or any other
          marketplace. Direct syndication integrations are planned for a later release.
        </p>
        <Button className="mt-4" disabled={exporting} onClick={handleExport}>
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
