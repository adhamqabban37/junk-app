"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { getSettings, updateSettings } from "@/lib/api/settings";

export default function SettingsPage() {
  const token = useAuthSession((s) => s.token);
  const [thresholdPercent, setThresholdPercent] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    getSettings(token)
      .then((s) => {
        setLoadError(false);
        setThresholdPercent(Math.round(s.aiConfidenceThreshold * 100));
      })
      .catch(() => setLoadError(true));
  }, [token, attempt]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!token || thresholdPercent === null || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings(token, { aiConfidenceThreshold: thresholdPercent / 100 });
      setSaved(true);
    } catch {
      setError("Couldn't save settings. Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <span>Couldn&apos;t load settings.</span>
        <button type="button" className="font-medium underline" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (thresholdPercent === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <form onSubmit={handleSave} className="flex max-w-md flex-col gap-4 rounded-xl border border-border p-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="ai-confidence-threshold" className="text-sm font-medium">
            AI confidence threshold
          </label>
          <p className="text-sm text-muted-foreground">
            AI grading below this confidence is flagged as &quot;needs review&quot; in the Review Queue
            instead of shown as a high-confidence suggestion.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="ai-confidence-threshold"
              type="number"
              min={0}
              max={100}
              value={thresholdPercent}
              onChange={(e) => {
                setSaved(false);
                setThresholdPercent(Number(e.target.value));
              }}
              className="w-24 rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
