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

const captureFromFileMock = vi.fn();
vi.mock("@/lib/offline/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/capture")>();
  return {
    ...actual,
    captureFromFile: (file: File) => captureFromFileMock(file),
  };
});

const classifyVehiclePhotosMock = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    classifyVehiclePhotos: (token: string, files: Blob[]) =>
      classifyVehiclePhotosMock(token, files),
  };
});

// The page reads the token to call the classifier; without one it skips the
// call entirely and asks the worker to assign by hand, which is a different
// path from the ones these tests exercise.
vi.mock("@/lib/auth-session", () => ({
  useAuthSession: (selector: (s: { token: string | null }) => unknown) =>
    selector({ token: "test-token" }),
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
    captureFromFileMock.mockReset();
    classifyVehiclePhotosMock.mockReset();
    classifyVehiclePhotosMock.mockResolvedValue([]);
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

  // INVERTED DELIBERATELY (2026-08-13) -- read before "fixing" it back.
  //
  // This asserted that Continue stayed disabled until all four angles were
  // captured. That is a good ideal and was a bad requirement: a car can be
  // against a wall, wrecked down one side, or simply worth photographing
  // from two angles because that is where the sellable parts are. Blocking
  // the entire intake over a missing "left" shot stopped work for a photo
  // nobody needed.
  //
  // The rule that survives is per-photo, not per-vehicle: every photo
  // present must have an angle, because the intake endpoint validates each
  // one against the enum and 400s the whole draft on an unassigned one.
  // That is covered by the next test.
  it("lets the worker continue with however many photos they have", async () => {
    await useIntakeStore.getState().addExteriorPhoto(draftId, makePhoto("front"));

    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled(),
    );
    // Coverage is reported, not enforced.
    expect(screen.getByText(/no photo yet for/i)).toBeInTheDocument();
  });

  it("still blocks Continue while any photo has no angle, since sync would reject it", async () => {
    await useIntakeStore.getState().addExteriorPhotos(draftId, [
      {
        id: "no-angle",
        blob: new Blob(["x"], { type: "image/jpeg" }),
        qualityFlags: { blurry: false, tooDark: false },
        capturedAt: new Date().toISOString(),
      },
    ]);

    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    expect(screen.getByText(/assign an angle to every photo/i)).toBeInTheDocument();
  });

  it("allows continuing with no exterior photos at all", async () => {
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
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

  // CHANGED DELIBERATELY (2026-08-13) -- read before "fixing" it back.
  //
  // This used to assert that uploading one file assigned it the *next*
  // required angle, because the picker was single-select and walked
  // front -> rear -> left -> right in a fixed order. A worker could not
  // select their whole walkaround at once, which is exactly what they
  // asked for. The picker is now multi-select and the AI assigns the
  // angles, so "the first file becomes front" is no longer true or
  // desirable -- selection order says nothing about which side a photo
  // shows.
  it("uploading photos saves them via captureFromFile and assigns the AI's angles", async () => {
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    classifyVehiclePhotosMock.mockResolvedValue([
      { index: 0, angle: "rear", confidence: 0.95, note: null },
      { index: 1, angle: "left", confidence: 0.91, note: null },
    ]);
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    expect(screen.getByText(/0 \/ 4/)).toBeInTheDocument();

    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);

    await waitFor(() => expect(screen.getByText(/2 \/ 4/)).toBeInTheDocument());
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    // Note these are NOT front/rear-in-selection-order: the AI said rear
    // and left, and that is what was stored.
    expect(draft?.exteriorPhotos.map((p) => p.angle)).toEqual(["rear", "left"]);
  });

  // The exterior step has to keep working with no connection -- the rest of
  // intake does, and losing a worker's photos because an API call failed
  // would be far worse than making them tap four buttons.
  it("keeps the photos and asks the worker to assign angles when classification fails", async () => {
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    classifyVehiclePhotosMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, [new File(["a"], "a.jpg", { type: "image/jpeg" })]);

    expect(await screen.findByText(/couldn't sort these automatically/i)).toBeInTheDocument();
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.exteriorPhotos).toHaveLength(1);
    expect(draft?.exteriorPhotos[0].angle).toBeUndefined();
    expect(screen.getByText(/1 photo needs an angle/i)).toBeInTheDocument();
  });

  // A photo the AI can't place must never be guessed at -- filing it under
  // the wrong side of the car is worse than making a person sort it.
  it("leaves an 'unknown' classification unassigned for the worker", async () => {
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    classifyVehiclePhotosMock.mockResolvedValue([
      { index: 0, angle: "unknown", confidence: 0.2, note: "interior shot" },
    ]);
    const user = userEvent.setup();
    render(<VehiclePageClient draftId={draftId} />);
    await screen.findByLabelText(/make/i);

    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, [new File(["a"], "a.jpg", { type: "image/jpeg" })]);

    expect(await screen.findByText(/1 photo needs an angle/i)).toBeInTheDocument();
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.exteriorPhotos[0].angle).toBeUndefined();
  });
});
