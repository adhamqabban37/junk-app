import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VehiclePageClient from "./vehicle-page-client";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import type { DraftPhoto, VehicleImageAngle } from "@/lib/offline/types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/hooks/use-camera", () => ({
  useCamera: () => ({ videoRef: { current: null }, ready: false, error: "no camera in tests" }),
}));

function makePhoto(angle: VehicleImageAngle): DraftPhoto {
  return {
    id: `${angle}-photo`,
    blob: new Blob(["x"], { type: "image/jpeg" }),
    angle,
    qualityFlags: { blurry: false, tooDark: false },
    capturedAt: new Date().toISOString(),
  };
}

describe("VehiclePageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
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

  it("disables Continue until all 4 exterior angles are captured", async () => {
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/0 \/ 4/)).toBeInTheDocument();
  });

  it("enables Continue once all 4 angles are captured, and saving navigates to Part Selection", async () => {
    for (const angle of ["front", "rear", "left", "right"] as const) {
      await useIntakeStore.getState().addExteriorPhoto(draftId, makePhoto(angle));
    }
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);

    await user.clear(await screen.findByLabelText(/make/i));
    await user.type(screen.getByLabelText(/make/i), "HONDA");
    await user.clear(screen.getByLabelText(/model/i));
    await user.type(screen.getByLabelText(/model/i), "Accord");

    const continueButton = screen.getByRole("button", { name: /continue/i });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/parts`));
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.decoded).toMatchObject({ make: "HONDA", model: "Accord" });
  });

  it("shows a quality warning badge on a captured photo flagged blurry or dark", async () => {
    const blurryPhoto = makePhoto("front");
    blurryPhoto.qualityFlags = { blurry: true, tooDark: false };
    await useIntakeStore.getState().addExteriorPhoto(draftId, blurryPhoto);

    render(<VehiclePageClient draftId={draftId} />);

    expect(await screen.findByText(/blurry/i)).toBeInTheDocument();
  });
});
