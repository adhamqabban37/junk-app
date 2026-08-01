import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("HomePage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    useIntakeStore.setState({ drafts: [], hydrated: false });
  });

  afterEach(async () => {
    await _resetDbForTests();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("junkyard-intake");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as Error);
    });
  });

  it("shows the empty state when there are no in-progress drafts", async () => {
    render(<HomePage />);
    expect(await screen.findByText(/no vehicles in progress/i)).toBeInTheDocument();
  });

  it("starting a new vehicle creates a draft and navigates to the VIN step", async () => {
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByText(/no vehicles in progress/i);

    await user.click(screen.getByRole("button", { name: /new vehicle/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const [path] = pushMock.mock.calls[0] as [string];
    expect(path).toMatch(/^\/intake\/[0-9a-f-]{36}\/vin$/);
    expect(useIntakeStore.getState().drafts).toHaveLength(1);
  });

  it("lists in-progress drafts and lets a worker resume one", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().setVin(draft.id, "1HGCM82633A123456", "manual");
    useIntakeStore.setState({ drafts: [], hydrated: false });

    const user = userEvent.setup();
    render(<HomePage />);

    const resumeButton = await screen.findByRole("button", { name: /1HGCM82633A123456/i });
    await user.click(resumeButton);

    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining(`/intake/${draft.id}/`));
  });

  it("does not list a draft that has already synced", async () => {
    const draft = await useIntakeStore.getState().createDraft();
    await useIntakeStore.getState().queueForSync(draft.id);
    await useIntakeStore.getState().markSynced(draft.id);
    useIntakeStore.setState({ drafts: [], hydrated: false });

    render(<HomePage />);

    expect(await screen.findByText(/no vehicles in progress/i)).toBeInTheDocument();
  });
});
