import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MobileVehiclesPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleListItem } from "@/lib/api/vehicles";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

vi.mock("@/lib/api/vehicles", () => ({ listVehicles: vi.fn() }));
import { listVehicles } from "@/lib/api/vehicles";

function makeVehicle(overrides: Partial<VehicleListItem> = {}): VehicleListItem {
  return {
    id: "veh-1",
    vin: "1HGCM82633A004352",
    make: "Honda",
    model: "Accord",
    year: 2003,
    trim: null,
    crushStatus: "active",
    createdAt: new Date().toISOString(),
    partsCount: 2,
    ...overrides,
  };
}

describe("MobileVehiclesPage", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(listVehicles).mockReset();
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "w1", tenantId: "t1", role: "worker", name: "Worker A" },
      restored: true,
    });
  });

  it("lists previously synced vehicles with their part counts", async () => {
    vi.mocked(listVehicles).mockResolvedValue({
      items: [makeVehicle()],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    render(<MobileVehiclesPage />);

    expect(await screen.findByText("2003 Honda Accord")).toBeInTheDocument();
    expect(screen.getByText("1HGCM82633A004352")).toBeInTheDocument();
    expect(screen.getByText("2 parts")).toBeInTheDocument();
  });

  it("requests within the backend's pageSize cap of 100", async () => {
    vi.mocked(listVehicles).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    render(<MobileVehiclesPage />);
    // ListVehiclesDto has @Max(100); asking for more 400s before touching the
    // database -- the exact bug that broke the desktop Vehicles screen.
    await vi.waitFor(() =>
      expect(listVehicles).toHaveBeenCalledWith("fake-token", { pageSize: 100 }),
    );
  });

  it("navigates to the vehicle's detail screen when tapped", async () => {
    vi.mocked(listVehicles).mockResolvedValue({
      items: [makeVehicle()],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const user = userEvent.setup();

    render(<MobileVehiclesPage />);
    await user.click(await screen.findByRole("button", { name: /2003 Honda Accord/ }));

    expect(pushMock).toHaveBeenCalledWith("/previous-vehicles/veh-1");
  });

  it("shows an error state distinguishable from the empty state", async () => {
    vi.mocked(listVehicles).mockRejectedValue(new Error("boom"));
    render(<MobileVehiclesPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/no vehicles yet/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing has synced yet", async () => {
    vi.mocked(listVehicles).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    render(<MobileVehiclesPage />);

    expect(await screen.findByText(/no vehicles yet/i)).toBeInTheDocument();
  });
});
