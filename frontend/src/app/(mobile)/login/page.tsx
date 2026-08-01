"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, listWorkers, loginManager, loginPin, type WorkerSummary } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { useTenantStore } from "@/lib/tenant-store";

function TenantSetupForm({ onBind }: { onBind: (tenantId: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      onBind(value.trim());
    } catch {
      setError("That doesn't look like a valid Tenant ID.");
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="w-full max-w-sm space-y-2 text-center">
        <h1 className="text-xl font-semibold">Set up this device</h1>
        <p className="text-sm text-muted-foreground">
          Enter the Yard/Tenant ID for this location. Ask your manager if you don&apos;t have it.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="tenantId" className="text-sm font-medium">
            Yard/Tenant ID
          </label>
          <Input
            id="tenantId"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full">
          Bind this device
        </Button>
      </form>
    </div>
  );
}

function WorkerLogin({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: (token: string) => void;
}) {
  const [workers, setWorkers] = useState<WorkerSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedWorker, setSelectedWorker] = useState<WorkerSummary | null>(null);
  const [pin, setPin] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listWorkers(tenantId)
      .then((result) => {
        if (!cancelled) setWorkers(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load workers");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWorker) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await loginPin(tenantId, selectedWorker.id, pin);
      onSuccess(token);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {loadError}
      </p>
    );
  }

  if (workers === null) {
    return <p className="p-6 text-sm text-muted-foreground">Loading workers…</p>;
  }

  if (workers.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <p className="font-medium">No workers configured yet</p>
        <p className="text-sm text-muted-foreground">
          Ask a manager to add a worker, or switch to Manager login.
        </p>
      </div>
    );
  }

  if (!selectedWorker) {
    return (
      <div className="grid gap-2 p-6">
        {workers.map((worker) => (
          <Button
            key={worker.id}
            variant="outline"
            className="justify-start"
            onClick={() => setSelectedWorker(worker)}
          >
            {worker.name}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{selectedWorker.name}</span>
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => {
            setSelectedWorker(null);
            setPin("");
            setSubmitError(null);
          }}
        >
          Not you?
        </button>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="pin" className="text-sm font-medium">
          PIN
        </label>
        <Input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </div>
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting || pin.length === 0}>
        Log in
      </Button>
    </form>
  );
}

function ManagerLogin({
  tenantId,
  onSuccess,
}: {
  tenantId: string;
  onSuccess: (token: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await loginManager(tenantId, email, password);
      onSuccess(token);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-6">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting}>
        Log in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthSession((s) => s.login);
  const tenantId = useTenantStore((s) => s.tenantId);
  const tenantHydrated = useTenantStore((s) => s.hydrated);
  const hydrateTenant = useTenantStore((s) => s.hydrate);
  const bindTenant = useTenantStore((s) => s.bind);
  const [mode, setMode] = useState<"worker" | "manager">("worker");

  useEffect(() => {
    hydrateTenant();
  }, [hydrateTenant]);

  function handleSuccess(token: string) {
    login(token);
    router.push("/");
  }

  if (!tenantHydrated) {
    return null;
  }

  if (tenantId === null) {
    return <TenantSetupForm onBind={bindTenant} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <div role="tablist" className="flex border-b border-border">
        <button
          role="tab"
          aria-selected={mode === "worker"}
          className={`flex-1 py-3 text-sm font-medium ${mode === "worker" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          onClick={() => setMode("worker")}
        >
          Worker
        </button>
        <button
          role="tab"
          aria-selected={mode === "manager"}
          className={`flex-1 py-3 text-sm font-medium ${mode === "manager" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}
          onClick={() => setMode("manager")}
        >
          Manager
        </button>
      </div>
      {mode === "worker" ? (
        <WorkerLogin tenantId={tenantId} onSuccess={handleSuccess} />
      ) : (
        <ManagerLogin tenantId={tenantId} onSuccess={handleSuccess} />
      )}
    </div>
  );
}
