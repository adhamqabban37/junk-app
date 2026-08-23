import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehiclesPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleListItem, VehicleListResult } from "@/lib/api/vehicles";

vi.mock("@/lib/api/vehicles", () => ({ listVehicles: vi.fn() }));
import { listVehicles } from "@/lib/api/vehicles";

function makeVehicle(overrides: Partial<VehicleListItem> = {}): VehicleListItem {
  return {
    id: "v1",
    vin: "1HGCM82633A123456",
    make: "Honda",
    model: "Accord",
    year: 2003,
    trim: "EX",
    crushStatus: "active",
    createdAt: new Date().toISOString(),
    partsCount: 4,
    latestGrade: null,
    firstPhotoId: null,
    ...overrides,
  };
}

function makeResult(items: VehicleListItem[]): VehicleListResult {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

describe("VehiclesPage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(listVehicles).mockReset();
  });

  it("shows a distinguishable error state, not the empty state, when vehicles fail to load", async () => {
    vi.mocked(listVehicles).mockRejectedValue(new Error("Request failed with status 500"));
    render(<VehiclesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/no vehicles in the yard/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no vehicles yet", async () => {
    vi.mocked(listVehicles).mockResolvedValue(makeResult([]));
    render(<VehiclesPage />);
    expect(await screen.findByText(/no vehicles in the yard/i)).toBeInTheDocument();
  });

  it("lists vehicles with VIN, description, crush status, and parts count", async () => {
    vi.mocked(listVehicles).mockResolvedValue(makeResult([makeVehicle()]));
    render(<VehiclesPage />);

    await screen.findByText("1HGCM82633A123456");
    const row = screen.getByTestId("vehicle-row-v1");
    expect(within(row).getByText(/2003 Honda Accord/i)).toBeInTheDocument();
    expect(within(row).getByText(/active/i)).toBeInTheDocument();
    expect(within(row).getByText(/4 parts/i)).toBeInTheDocument();
  });

  it("shows the vehicle's latest grade badge when graded", async () => {
    vi.mocked(listVehicles).mockResolvedValue(
      makeResult([makeVehicle({ latestGrade: { grade: "A", status: "complete", photoCount: 3 } })]),
    );
    render(<VehiclesPage />);
    const row = await screen.findByTestId("vehicle-row-v1");
    expect(within(row).getByText(/grade a/i)).toBeInTheDocument();
  });

  it("shows 'not graded yet' when the vehicle has no grade", async () => {
    vi.mocked(listVehicles).mockResolvedValue(makeResult([makeVehicle({ latestGrade: null })]));
    render(<VehiclesPage />);
    const row = await screen.findByTestId("vehicle-row-v1");
    expect(within(row).getByText(/not graded yet/i)).toBeInTheDocument();
  });

  it("filters by crush status", async () => {
    vi.mocked(listVehicles).mockResolvedValue(makeResult([makeVehicle()]));
    const user = userEvent.setup();

    render(<VehiclesPage />);
    await screen.findByText("1HGCM82633A123456");

    await user.selectOptions(screen.getByLabelText(/crush status/i), "crushed");

    await waitFor(() =>
      expect(listVehicles).toHaveBeenLastCalledWith(
        "fake-token",
        expect.objectContaining({ crushStatus: "crushed" }),
      ),
    );
  });
});
