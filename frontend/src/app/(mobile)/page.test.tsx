import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import { _resetDbForTests } from "@/lib/offline/db";
import { useIntakeStore } from "@/lib/offline/store";
import type { MyVehicleListItem, MyVehicleListResult } from "@/lib/api/vehicles";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api/vehicles", () => ({ listMyVehicles: vi.fn() }));
import { listMyVehicles } from "@/lib/api/vehicles";

function makeMyVehicle(overrides: Partial<MyVehicleListItem> = {}): MyVehicleListItem {
  return {
    id: "v1",
    vin: "1HGCM82633A123456",
    make: "Honda",
    model: "Accord",
    year: 2003,
    trim: "EX",
    crushStatus: "active",
    createdAt: new Date().toISOString(),
    partsCount: 0,
    unassignedPhotosCount: 2,
    latestGrade: null,
    firstPhotoId: null,
    ...overrides,
  };
}

function makeMyResult(items: MyVehicleListItem[]): MyVehicleListResult {
  return { items, total: items.length, page: 1, pageSize: 25 };
}

describe("HomePage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    useIntakeStore.setState({ drafts: [], hydrated: false });
    useAuthSession.setState({ token: null, claims: null, restored: true });
    vi.mocked(listMyVehicles).mockReset();
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

  describe("sent vehicles (once a session exists)", () => {
    beforeEach(() => {
      useAuthSession.setState({
        token: "fake-token",
        claims: { sub: "w1", tenantId: "t1", role: "worker", name: "Worker A" },
        restored: true,
      });
    });

    it("shows previously sent vehicles and navigates into one on tap", async () => {
      vi.mocked(listMyVehicles).mockResolvedValue(makeMyResult([makeMyVehicle()]));
      const user = userEvent.setup();
      render(<HomePage />);

      const row = await screen.findByRole("button", { name: /1HGCM82633A123456/i });
      expect(row).toHaveTextContent(/2 photos waiting on a manager/i);

      await user.click(row);
      expect(pushMock).toHaveBeenCalledWith("/my-vehicles/v1");
    });

    it("shows nothing extra when the worker has never sent a vehicle", async () => {
      vi.mocked(listMyVehicles).mockResolvedValue(makeMyResult([]));
      render(<HomePage />);
      await waitFor(() => expect(listMyVehicles).toHaveBeenCalled());
      expect(screen.queryByText(/your sent vehicles/i)).not.toBeInTheDocument();
    });

    it("shows a distinguishable error state with retry when the sent-vehicles list fails to load", async () => {
      vi.mocked(listMyVehicles).mockRejectedValue(new Error("Request failed with status 500"));
      render(<HomePage />);
      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load your sent vehicles/i);
    });
  });
});
