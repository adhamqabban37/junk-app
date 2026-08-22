import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehiclePageClient from "./vehicle-page-client";
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

  it("disables Finish until at least one photo is captured, with no part/taxonomy picker involved", async () => {
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByRole("button", { name: /finish/i })).toBeDisabled();
    expect(screen.getByText(/0 captured/i)).toBeInTheDocument();
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
