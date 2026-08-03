import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PartCameraPageClient from "./part-camera-page-client";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const mockUseCamera = vi.fn();
vi.mock("@/hooks/use-camera", () => ({
  useCamera: () => mockUseCamera(),
}));

const captureFromFileMock = vi.fn();
vi.mock("@/lib/offline/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/capture")>();
  return {
    ...actual,
    captureFromFile: (file: File) => captureFromFileMock(file),
  };
});

describe("PartCameraPageClient", () => {
  let draftId: string;
  const partId = "part-1";

  beforeEach(async () => {
    pushMock.mockReset();
    captureFromFileMock.mockReset();
    mockUseCamera.mockReturnValue({
      videoRef: { current: null },
      ready: false,
      error: "no camera in tests",
    });
    useIntakeStore.setState({ drafts: [], hydrated: false });
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().addPart(draft.id, {
      id: partId,
      taxonomyId: "tax-alt",
      taxonomyName: "Alternator",
      photos: [],
    });
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

  it("shows the part name and a camera-unavailable message when there's no camera", async () => {
    render(<PartCameraPageClient draftId={draftId} partId={partId} />);
    expect(await screen.findByText(/alternator/i)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no camera in tests/i);
  });

  it("disables Done until at least one photo has been saved for this part", async () => {
    render(<PartCameraPageClient draftId={draftId} partId={partId} />);
    await screen.findByText(/alternator/i);
    expect(screen.getByRole("button", { name: /^done$/i })).toBeDisabled();
  });

  it("enables Done once a photo exists, and Done navigates back to Part Selection", async () => {
    await useIntakeStore.getState().addPartPhoto(draftId, partId, {
      id: "photo-1",
      blob: new Blob(["x"]),
      qualityFlags: { blurry: false, tooDark: false },
      capturedAt: new Date().toISOString(),
    });
    const user = userEvent.setup();
    render(<PartCameraPageClient draftId={draftId} partId={partId} />);

    const doneButton = await screen.findByRole("button", { name: /^done$/i });
    await waitFor(() => expect(doneButton).toBeEnabled());
    await user.click(doneButton);

    expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/parts`);
  });

  it("flags a blurry saved photo with a visible warning", async () => {
    await useIntakeStore.getState().addPartPhoto(draftId, partId, {
      id: "photo-1",
      blob: new Blob(["x"]),
      qualityFlags: { blurry: true, tooDark: false },
      capturedAt: new Date().toISOString(),
    });

    render(<PartCameraPageClient draftId={draftId} partId={partId} />);

    expect(await screen.findByText(/blurry/i)).toBeInTheDocument();
  });

  it("uploading a photo file saves it via captureFromFile and enables Done, without needing the live camera", async () => {
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    const user = userEvent.setup();
    render(<PartCameraPageClient draftId={draftId} partId={partId} />);
    await screen.findByText(/alternator/i);

    const file = new File(["fake-bytes"], "part.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/choose photo/i);
    await user.upload(input, file);

    expect(captureFromFileMock).toHaveBeenCalledWith(file);
    const doneButton = await screen.findByRole("button", { name: /^done$/i });
    await waitFor(() => expect(doneButton).toBeEnabled());
  });
});
