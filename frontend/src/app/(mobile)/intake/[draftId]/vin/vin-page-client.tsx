"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decodeVin } from "@/lib/nhtsa";
import { useIntakeStore } from "@/lib/offline/store";
import { isBarcodeScanSupported, isValidVinFormat } from "@/lib/vin";

export default function VinPageClient({ draftId }: { draftId: string }) {
  const router = useRouter();
  const hydrate = useIntakeStore((s) => s.hydrate);
  const hydrated = useIntakeStore((s) => s.hydrated);
  const setVin = useIntakeStore((s) => s.setVin);
  const setDecoded = useIntakeStore((s) => s.setDecoded);

  const [vin, setVinValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const scanSupported = isBarcodeScanSupported();

  useEffect(() => {
    if (!hydrated) {
      void hydrate();
    }
  }, [hydrated, hydrate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = vin.trim().toUpperCase();
    if (!isValidVinFormat(normalized)) {
      setError("VIN must be 17 characters (letters/numbers, no I, O, or Q).");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await setVin(draftId, normalized, "manual");
      try {
        const decoded = await decodeVin(normalized);
        await setDecoded(draftId, decoded);
      } catch {
        // Best-effort: NHTSA decode failing (network, undecodable VIN) is
        // not blocking — the Vehicle Context screen falls back to manual
        // make/model/year entry when `decoded` is still null.
      }
      router.push(`/intake/${draftId}/vehicle`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Scan or enter VIN</h1>

      {scanSupported && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Point the camera at the VIN barcode, or enter it manually below.
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="vin" className="text-sm font-medium">
            VIN
          </label>
          <Input
            id="vin"
            value={vin}
            onChange={(e) => setVinValue(e.target.value)}
            maxLength={17}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="1HGCM82633A123456"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={submitting}>
          Continue
        </Button>
      </form>
    </div>
  );
}
