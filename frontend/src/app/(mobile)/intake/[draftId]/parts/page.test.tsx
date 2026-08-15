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
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

function makePhoto(id: string) {
  return {
    id,
    blob: new Blob(["x"], { type: "image/jpeg" }),
    angle: "front" as const,
    qualityFlags: { blurry: false, tooDark: false },
    capturedAt: new Date().toISOString(),
  };
}

describe("PartsPageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
    replaceMock.mockReset();
    sessionStorage.clear();
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

  it("keeps Finish disabled and names the part if any added part still has zero photos", async () => {
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
    await useIntakeStore.getState().addPart(draftId, {
      id: "part-2",
      taxonomyId: "tax-radiator",
      taxonomyName: "Radiator",
      photos: [],
    });
    render(<PartsPageClient draftId={draftId} />);

    expect(await screen.findByRole("button", { name: /finish/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Radiator");
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

    expect(
      await screen.findByRole("button", { name: /alternator.*0 photos/i }),
    ).toBeInTheDocument();
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

  describe("when the vehicle already has photos", () => {
    // The bug this prevents, in full: a worker uploads ten walkaround
    // photos, lands on an empty part list, taps nine parts out of the
    // taxonomy by hand -- each created with no photo -- and is then blocked
    // by "Still needs a photo: Bumper (Front), Door (Driver Front), ..."
    // for photos they had already taken. They should be scanning instead.
    it("sends the worker to the scan rather than an empty list", async () => {
      await useIntakeStore.getState().addExteriorPhoto(draftId, makePhoto("p1"));

      render(<PartsPageClient draftId={draftId} />);

      await waitFor(() =>
        expect(replaceMock).toHaveBeenCalledWith(`/intake/${draftId}/scan`),
      );
    });

    it("does not redirect once parts exist", async () => {
      await useIntakeStore.getState().addExteriorPhoto(draftId, makePhoto("p1"));
      await useIntakeStore.getState().addPart(draftId, {
        id: "part-1",
        taxonomyId: "tax-alt",
        taxonomyName: "Alternator",
        photos: [],
      });

      render(<PartsPageClient draftId={draftId} />);
      await screen.findByText(/added/i);

      expect(replaceMock).not.toHaveBeenCalled();
    });

    // Without a flag that survives navigation this is an inescapable loop:
    // the worker returns here to pick a part by hand, the page remounts with
    // the same photos-and-no-parts state, and gets bounced straight back.
    it("only offers the scan once, so returning by hand is possible", async () => {
      await useIntakeStore.getState().addExteriorPhoto(draftId, makePhoto("p1"));

      const first = render(<PartsPageClient draftId={draftId} />);
      await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
      first.unmount();

      render(<PartsPageClient draftId={draftId} />);
      await screen.findByRole("button", { name: /scan parts from photos/i });

      expect(replaceMock).toHaveBeenCalledTimes(1);
    });
  });

  // Long-standing P1: a part is created the moment it is picked, so one
  // mis-tap produced a photo-less part that could not be deleted and that
  // the Finish gate then refused to ship -- making the whole draft
  // unshippable.
  it("removes a mis-tapped part", async () => {
    await useIntakeStore.getState().addPart(draftId, {
      id: "part-1",
      taxonomyId: "tax-alt",
      taxonomyName: "Alternator",
      photos: [],
    });
    const user = userEvent.setup();
    render(<PartsPageClient draftId={draftId} />);

    await user.click(
      await screen.findByRole("button", { name: /remove alternator/i }),
    );

    await waitFor(() => {
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.parts).toHaveLength(0);
    });
  });
});
