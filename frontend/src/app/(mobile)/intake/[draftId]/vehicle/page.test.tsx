import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehiclePageClient from "./vehicle-page-client";
import { useAuthSession } from "@/lib/auth-session";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import type { DraftPhoto } from "@/lib/offline/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/use-camera", () => ({
  useCamera: () => ({ videoRef: { current: null }, ready: false, error: "no camera in tests" }),
}));

const captureFromFileMock = vi.fn();
vi.mock("@/lib/offline/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/capture")>();
  return {
    ...actual,
    captureFromFile: (file: File) => captureFromFileMock(file),
  };
});

// Mocked at the createFetchSyncClient boundary, not raw fetch: building the
// real multipart FormData in jsdom hits a known jsdom-vs-Node dual-Blob-class
// incompatibility (jsdom's FormData.append rejects a Blob that isn't its own
// Blob class) that only exists in this test environment, never in a real
// browser, which has a single Blob implementation. syncPendingDrafts itself
// stays real -- only the network boundary is faked, same as sync.test.ts.
const syncDraftMock = vi.fn();
vi.mock("@/lib/offline/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/sync")>();
  return {
    ...actual,
    createFetchSyncClient: () => ({ syncDraft: syncDraftMock }),
  };
});

function makePhoto(id: string): DraftPhoto {
  return {
    id,
    blob: new Blob(["x"], { type: "image/jpeg" }),
    qualityFlags: { blurry: false, tooDark: false },
    capturedAt: new Date().toISOString(),
  };
}

describe("VehiclePageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
    captureFromFileMock.mockReset();
    useIntakeStore.setState({ drafts: [], hydrated: false });
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().setVin(draft.id, "1HGCM82633A123456", "manual");
    draftId = draft.id;
  });

  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("prefills the form from NHTSA-decoded data when available", async () => {
    await useIntakeStore
      .getState()
      .setDecoded(draftId, { make: "HONDA", model: "Accord", year: 2003, trim: "EX", raw: {} });

    render(<VehiclePageClient draftId={draftId} />);

    expect(await screen.findByLabelText(/make/i)).toHaveValue("HONDA");
    expect(screen.getByLabelText(/model/i)).toHaveValue("Accord");
    expect(screen.getByLabelText(/^year$/i)).toHaveValue(2003);
  });

  it("renders blank editable fields for manual entry when NHTSA decode failed (decoded is null)", async () => {
    render(<VehiclePageClient draftId={draftId} />);

    expect(await screen.findByLabelText(/make/i)).toHaveValue("");
    expect(screen.getByLabelText(/model/i)).toHaveValue("");
  });

  it("allows finishing with zero photos (send whatever's available), with no part/taxonomy picker involved", async () => {
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByRole("button", { name: /finish/i })).toBeEnabled();
    expect(screen.getByText(/0 captured/i)).toBeInTheDocument();
    expect(screen.getByText(/no photos yet/i)).toBeInTheDocument();
  });

  it("enables Finish once a photo is captured, and finishing queues the draft for sync and navigates home", async () => {
    await useIntakeStore.getState().addPhoto(draftId, makePhoto("photo-1"));
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);

    await user.clear(await screen.findByLabelText(/make/i));
    await user.type(screen.getByLabelText(/make/i), "HONDA");
    await user.clear(screen.getByLabelText(/model/i));
    await user.type(screen.getByLabelText(/model/i), "Accord");

    const finishButton = screen.getByRole("button", { name: /finish/i });
    await waitFor(() => expect(finishButton).toBeEnabled());
    await user.click(finishButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.decoded).toMatchObject({ make: "HONDA", model: "Accord" });
    expect(draft?.status).toBe("queued");
  });

  describe("with an active session (immediate send)", () => {
    beforeEach(() => {
      useAuthSession.getState().login("fake-token");
      syncDraftMock.mockReset();
    });

    afterEach(() => {
      useAuthSession.getState().logout();
    });

    it("finishing attempts a real send immediately, and navigates home once it lands", async () => {
      syncDraftMock.mockResolvedValue(undefined);
      await useIntakeStore.getState().addPhoto(draftId, makePhoto("photo-1"));
      const user = userEvent.setup();
      render(<VehiclePageClient draftId={draftId} />);

      const finishButton = await screen.findByRole("button", { name: /finish/i });
      await waitFor(() => expect(finishButton).toBeEnabled());
      await user.click(finishButton);

      await waitFor(() => expect(syncDraftMock).toHaveBeenCalledTimes(1));
      expect(syncDraftMock.mock.calls[0]?.[0]).toMatchObject({ id: draftId });
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.status).toBe("synced");
    });

    it("stays on the page and shows an inline error when the immediate send fails, instead of silently navigating away", async () => {
      syncDraftMock.mockRejectedValue(new Error("network unreachable"));
      await useIntakeStore.getState().addPhoto(draftId, makePhoto("photo-1"));
      const user = userEvent.setup();
      render(<VehiclePageClient draftId={draftId} />);

      const finishButton = await screen.findByRole("button", { name: /finish/i });
      await waitFor(() => expect(finishButton).toBeEnabled());
      await user.click(finishButton);

      expect(await screen.findByText(/couldn.t send yet/i)).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
      const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
      expect(draft?.status).toBe("sync_failed");
    });
  });

  it("shows a quality warning badge on a captured photo flagged blurry or dark", async () => {
    const blurryPhoto = makePhoto("photo-1");
    blurryPhoto.qualityFlags = { blurry: true, tooDark: false };
    await useIntakeStore.getState().addPhoto(draftId, blurryPhoto);

    render(<VehiclePageClient draftId={draftId} />);

    expect(await screen.findByText(/blurry/i)).toBeInTheDocument();
  });

  it("uploading a photo file saves it via captureFromFile, without needing the live camera or picking a part", async () => {
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByText(/0 captured/i)).toBeInTheDocument();

    const file = new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/choose photo/i);
    await user.upload(input, file);

    expect(captureFromFileMock).toHaveBeenCalledWith(file);
    await waitFor(() => expect(screen.getByText(/1 captured/i)).toBeInTheDocument());
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.photos).toHaveLength(1);
  });
});
