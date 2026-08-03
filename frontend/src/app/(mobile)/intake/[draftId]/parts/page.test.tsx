import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PartsPageClient from "./parts-page-client";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import { useTaxonomyStore } from "@/lib/offline/taxonomy-store";
import { useAuthSession } from "@/lib/auth-session";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("PartsPageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline in tests")),
    );
    useIntakeStore.setState({ drafts: [], hydrated: false });
    useTaxonomyStore.setState({
      items: [
        { id: "tax-alt", name: "Alternator", category: "Electrical", isQuickPick: true },
        { id: "tax-starter", name: "Starter", category: "Electrical", isQuickPick: false },
        { id: "tax-radiator", name: "Radiator", category: "Cooling", isQuickPick: true },
      ],
      hydrated: true,
    });
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "u1", tenantId: "t1", role: "worker", name: "Worker A" },
      restored: true,
    });
    const draft = await useIntakeStore.getState().createDraft();
    draftId = draft.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("shows quick-pick parts prominently", async () => {
    render(<PartsPageClient draftId={draftId} />);
    expect(await screen.findByRole("button", { name: "Alternator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Radiator" })).toBeInTheDocument();
  });

  it("selecting a taxonomy item creates a part on the draft and navigates to its camera step", async () => {
    const user = userEvent.setup();
    render(<PartsPageClient draftId={draftId} />);

    await user.click(await screen.findByRole("button", { name: "Alternator" }));

    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.parts).toHaveLength(1);
    expect(draft?.parts[0].taxonomyName).toBe("Alternator");
    const partId = draft?.parts[0].id;
    expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/parts/${partId}/camera`);
  });

  it("disables Finish until at least one part has a photo", async () => {
    render(<PartsPageClient draftId={draftId} />);
    await screen.findByRole("button", { name: "Alternator" });
    expect(screen.getByRole("button", { name: /finish/i })).toBeDisabled();
  });

  it("Finish queues the draft for sync and returns to Home once a part has a photo", async () => {
    await useIntakeStore.getState().addPart(draftId, {
      id: "part-1",
      taxonomyId: "tax-alt",
      taxonomyName: "Alternator",
      photos: [
        {
          id: "photo-1",
          blob: new Blob(["x"]),
          qualityFlags: { blurry: false, tooDark: false },
          capturedAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<PartsPageClient draftId={draftId} />);

    const finishButton = await screen.findByRole("button", { name: /finish/i });
    await waitFor(() => expect(finishButton).toBeEnabled());
    await user.click(finishButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.status).toBe("queued");
  });

  it("lists already-added parts with their photo counts", async () => {
    await useIntakeStore.getState().addPart(draftId, {
      id: "part-1",
      taxonomyId: "tax-alt",
      taxonomyName: "Alternator",
      photos: [],
    });

    render(<PartsPageClient draftId={draftId} />);

    expect(await screen.findByText(/Alternator/)).toBeInTheDocument();
    expect(screen.getByText(/0 photos/i)).toBeInTheDocument();
  });

  it("clicking an already-added part (e.g. one with 0 photos, camera failed the first time) navigates back to its camera step", async () => {
    await useIntakeStore.getState().addPart(draftId, {
      id: "part-1",
      taxonomyId: "tax-alt",
      taxonomyName: "Alternator",
      photos: [],
    });
    const user = userEvent.setup();
    render(<PartsPageClient draftId={draftId} />);

    await user.click(await screen.findByRole("button", { name: /alternator.*0 photos/i }));

    expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/parts/part-1/camera`);
  });
});
