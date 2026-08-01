import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VinPageClient from "./vin-page-client";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/nhtsa", () => ({
  decodeVin: vi.fn(),
  VinDecodeError: class VinDecodeError extends Error {},
}));

vi.mock("@/lib/vin", async () => {
  const actual = await vi.importActual<typeof import("@/lib/vin")>("@/lib/vin");
  return { ...actual, isBarcodeScanSupported: vi.fn(() => false) };
});

import { decodeVin } from "@/lib/nhtsa";

describe("VinPageClient", () => {
  let draftId: string;

  beforeEach(async () => {
    pushMock.mockReset();
    vi.mocked(decodeVin).mockReset();
    useIntakeStore.setState({ drafts: [], hydrated: false });
    const draft = await useIntakeStore.getState().createDraft();
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

  it("does not render a barcode scan section when the browser doesn't support it (manual-only fallback)", async () => {
    render(<VinPageClient draftId={draftId} />);
    await screen.findByLabelText(/vin/i);
    expect(screen.queryByText(/point the camera/i)).not.toBeInTheDocument();
  });

  it("rejects an invalid VIN before submitting, without calling decodeVin", async () => {
    const user = userEvent.setup();
    render(<VinPageClient draftId={draftId} />);

    await user.type(await screen.findByLabelText(/vin/i), "TOO-SHORT");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/17 characters/i);
    expect(decodeVin).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("on a valid VIN with a successful decode, saves the VIN + decoded info and navigates to the vehicle step", async () => {
    vi.mocked(decodeVin).mockResolvedValue({
      make: "HONDA",
      model: "Accord",
      year: 2003,
      trim: "EX",
      raw: {},
    });
    const user = userEvent.setup();
    render(<VinPageClient draftId={draftId} />);

    await user.type(await screen.findByLabelText(/vin/i), "1HGCM82633A123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/vehicle`));
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.vin).toBe("1HGCM82633A123456");
    expect(draft?.vinEntryMethod).toBe("manual");
    expect(draft?.decoded?.make).toBe("HONDA");
  });

  it("still saves the VIN and navigates onward when NHTSA decode fails (manual vehicle-info fallback happens on the next screen)", async () => {
    vi.mocked(decodeVin).mockRejectedValue(new Error("NHTSA could not decode this VIN"));
    const user = userEvent.setup();
    render(<VinPageClient draftId={draftId} />);

    await user.type(await screen.findByLabelText(/vin/i), "1HGCM82633A123456");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/intake/${draftId}/vehicle`));
    const draft = useIntakeStore.getState().drafts.find((d) => d.id === draftId);
    expect(draft?.vin).toBe("1HGCM82633A123456");
    expect(draft?.decoded).toBeNull();
  });
});
