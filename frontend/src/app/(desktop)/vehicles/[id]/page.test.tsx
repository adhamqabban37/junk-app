import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleDetailPageClient from "./vehicle-detail-page-client";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleDetail } from "@/lib/api/vehicles";
import type { VehiclePhotoSummary } from "@/lib/api/vehicle-photos";
import type { TaxonomyItemResponse } from "@/lib/api";

vi.mock("@/lib/api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("@/lib/api/vehicle-photos", () => ({
  listVehiclePhotos: vi.fn(),
  assignVehiclePhotos: vi.fn(),
  fetchVehiclePhotoBlob: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchTaxonomy: vi.fn() };
});

import { getVehicle } from "@/lib/api/vehicles";
import {
  assignVehiclePhotos,
  fetchVehiclePhotoBlob,
  listVehiclePhotos,
} from "@/lib/api/vehicle-photos";
import { fetchTaxonomy } from "@/lib/api";

function makeVehicle(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
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
    parts: [],
    ...overrides,
  };
}

function makePhoto(overrides: Partial<VehiclePhotoSummary> = {}): VehiclePhotoSummary {
  return { id: "photo-1", createdAt: new Date().toISOString(), ...overrides };
}

const taxonomies: TaxonomyItemResponse[] = [
  { id: "tax-1", name: "Alternator", category: "Electrical", isQuickPick: true },
  { id: "tax-2", name: "Radiator", category: "Cooling", isQuickPick: false },
];

describe("VehicleDetailPageClient", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(getVehicle).mockReset();
    vi.mocked(listVehiclePhotos).mockReset();
    vi.mocked(assignVehiclePhotos).mockReset();
    vi.mocked(fetchVehiclePhotoBlob).mockReset();
    vi.mocked(fetchTaxonomy).mockReset();
    vi.mocked(fetchVehiclePhotoBlob).mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    vi.mocked(fetchTaxonomy).mockResolvedValue(taxonomies);
  });

  it("shows a distinguishable error state when loading fails", async () => {
    vi.mocked(getVehicle).mockRejectedValue(new Error("Request failed with status 500"));
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
  });

  it("shows the empty state when there are no unassigned photos", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByText(/no unassigned photos/i)).toBeInTheDocument();
  });

  it("renders unassigned photos and the vehicle title/VIN", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" }), makePhoto({ id: "photo-2" })]);
    render(<VehicleDetailPageClient vehicleId="v1" />);

    expect(await screen.findByText(/2003 Honda Accord EX/i)).toBeInTheDocument();
    expect(screen.getByText(/1HGCM82633A123456/)).toBeInTheDocument();
    expect(screen.getByTestId("unassigned-photo-photo-1")).toBeInTheDocument();
    expect(screen.getByTestId("unassigned-photo-photo-2")).toBeInTheDocument();
  });

  it("assigns selected photos to a chosen taxonomy, then removes them from the unassigned grid", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" }), makePhoto({ id: "photo-2" })]);
    vi.mocked(assignVehiclePhotos).mockResolvedValue({ partId: "new-part-1" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="v1" />);
    await screen.findByTestId("unassigned-photo-photo-1");

    await user.click(screen.getByTestId("unassigned-photo-photo-1"));
    await user.click(screen.getByRole("button", { name: "Alternator" }));

    const assignButton = screen.getByRole("button", { name: /assign 1 photo/i });
    await waitFor(() => expect(assignButton).toBeEnabled());
    await user.click(assignButton);

    await waitFor(() =>
      expect(assignVehiclePhotos).toHaveBeenCalledWith("fake-token", "v1", ["photo-1"], "tax-1"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("unassigned-photo-photo-1")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("unassigned-photo-photo-2")).toBeInTheDocument();
  });

  it("disables Assign until both a photo and a taxonomy are selected", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" })]);
    render(<VehicleDetailPageClient vehicleId="v1" />);

    await screen.findByTestId("unassigned-photo-photo-1");
    expect(screen.getByRole("button", { name: /assign 0 photo/i })).toBeDisabled();
  });
});
