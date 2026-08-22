import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyVehicleDetailPageClient from "./my-vehicle-detail-page-client";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleDetail } from "@/lib/api/vehicles";
import type { VehiclePhotoSummary } from "@/lib/api/vehicle-photos";

vi.mock("@/lib/api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("@/lib/api/vehicle-photos", () => ({
  listVehiclePhotos: vi.fn(),
  addVehiclePhotos: vi.fn(),
  fetchVehiclePhotoBlob: vi.fn(),
}));
vi.mock("@/hooks/use-camera", () => ({
  useCamera: () => ({ videoRef: { current: null }, ready: false, error: "no camera in tests" }),
}));

const captureFromFileMock = vi.fn();
vi.mock("@/lib/offline/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/capture")>();
  return { ...actual, captureFromFile: (file: File) => captureFromFileMock(file) };
});

import { getVehicle } from "@/lib/api/vehicles";
import { addVehiclePhotos, fetchVehiclePhotoBlob, listVehiclePhotos } from "@/lib/api/vehicle-photos";

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
    partsCount: 1,
    parts: [],
    ...overrides,
  };
}

function makePhoto(overrides: Partial<VehiclePhotoSummary> = {}): VehiclePhotoSummary {
  return { id: "photo-1", createdAt: new Date().toISOString(), ...overrides };
}

describe("MyVehicleDetailPageClient", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "w1", tenantId: "t1", role: "worker", name: "Worker A" },
      restored: true,
    });
    vi.mocked(getVehicle).mockReset();
    vi.mocked(listVehiclePhotos).mockReset();
    vi.mocked(addVehiclePhotos).mockReset();
    vi.mocked(fetchVehiclePhotoBlob).mockReset();
    captureFromFileMock.mockReset();
    vi.mocked(fetchVehiclePhotoBlob).mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
  });

  it("shows a distinguishable error state when loading fails", async () => {
    vi.mocked(getVehicle).mockRejectedValue(new Error("Request failed with status 500"));
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
  });

  it("renders the vehicle title/VIN and its already-sent photos", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" }), makePhoto({ id: "photo-2" })]);
    render(<MyVehicleDetailPageClient vehicleId="v1" />);

    expect(await screen.findByText(/2003 Honda Accord EX/i)).toBeInTheDocument();
    expect(screen.getByText(/1HGCM82633A123456/)).toBeInTheDocument();
    expect(screen.getByText(/2 waiting on a manager/i)).toBeInTheDocument();
  });

  it("uploading a chosen photo file sends it immediately and adds it to the grid", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    vi.mocked(addVehiclePhotos).mockResolvedValue([makePhoto({ id: "new-photo" })]);
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/0 waiting on a manager/i);

    const file = new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/choose more photos/i);
    await user.upload(input, file);

    await waitFor(() => expect(addVehiclePhotos).toHaveBeenCalledWith("fake-token", "v1", [
      expect.objectContaining({ blob: expect.anything() }),
    ]));
    await waitFor(() => expect(screen.getByText(/1 waiting on a manager/i)).toBeInTheDocument());
  });

  it("shows an inline error when an upload fails, without losing existing photos", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" })]);
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    vi.mocked(addVehiclePhotos).mockRejectedValue(new Error("network unreachable"));
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/1 waiting on a manager/i);

    const file = new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/choose more photos/i);
    await user.upload(input, file);

    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/1 waiting on a manager/i)).toBeInTheDocument();
  });
});
