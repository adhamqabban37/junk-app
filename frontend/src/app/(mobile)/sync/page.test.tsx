import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SyncPage from "./page";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import { useAuthSession } from "@/lib/auth-session";

vi.mock("@/lib/offline/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/offline/sync")>("@/lib/offline/sync");
  return { ...actual, syncPendingDrafts: vi.fn() };
});

import { syncPendingDrafts } from "@/lib/offline/sync";

describe("SyncPage", () => {
  beforeEach(() => {
    useIntakeStore.setState({ drafts: [], hydrated: false });
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "u1", tenantId: "t1", role: "worker", name: "Worker A" },
      restored: true,
    });
    vi.mocked(syncPendingDrafts).mockReset();
    vi.mocked(syncPendingDrafts).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("shows the empty state when nothing is queued", async () => {
    render(<SyncPage />);
    expect(await screen.findByText(/nothing to sync/i)).toBeInTheDocument();
  });

  it("lists queued and failed drafts with their status", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().setVin(draft.id, "1HGCM82633A123456", "manual");
    await useIntakeStore.getState().queueForSync(draft.id);

    const failedDraft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().markSyncFailed(failedDraft.id, "network unreachable");

    render(<SyncPage />);

    expect(await screen.findByText("1HGCM82633A123456")).toBeInTheDocument();
    expect(screen.getByText(/network unreachable/i)).toBeInTheDocument();
  });

  it("does not list an already-synced draft", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);
    await useIntakeStore.getState().markSynced(draft.id);

    render(<SyncPage />);

    expect(await screen.findByText(/nothing to sync/i)).toBeInTheDocument();
  });

  it("tapping Sync now triggers a sync attempt", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);
    const user = userEvent.setup();

    render(<SyncPage />);
    await screen.findByRole("button", { name: /sync now/i });
    await user.click(screen.getByRole("button", { name: /sync now/i }));

    await waitFor(() => expect(syncPendingDrafts).toHaveBeenCalledTimes(1));
  });
});
