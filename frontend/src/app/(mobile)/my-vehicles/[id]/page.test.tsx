import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyVehicleDetailPageClient from "./my-vehicle-detail-page-client";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleDetail } from "@/lib/api/vehicles";
import type { VehiclePhotoSummary } from "@/lib/api/vehicle-photos";

vi.mock("@/lib/api/vehicles", () => ({ getVehicle: vi.fn() }));
vi.mock("@/lib/api/vehicle-photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/vehicle-photos")>();
  return {
    ...actual,
    listVehiclePhotos: vi.fn(),
    addVehiclePhotos: vi.fn(),
    fetchVehiclePhotoBlob: vi.fn(),
  };
});
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
    latestGrade: null,
    firstPhotoId: null,
    parts: [],
    latestVehicleAnalysis: null,
    ...overrides,
  };
}

function makePhoto(overrides: Partial<VehiclePhotoSummary> = {}): VehiclePhotoSummary {
  return {
    id: "photo-1",
    createdAt: new Date().toISOString(),
    section: null,
    suggestions: [],
    ...overrides,
  };
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

  it("picking photos stages them locally without uploading anything yet", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/0 waiting on a manager/i);

    const file = new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, file);

    expect(await screen.findByText(/1 photo ready to upload/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload 1 photo/i })).toBeInTheDocument();
    // Nothing sent to the server until Upload is tapped -- this is the fix
    // for "they just disappear, nothing" (per-photo silent auto-upload).
    expect(addVehiclePhotos).not.toHaveBeenCalled();
    expect(screen.getByText(/0 waiting on a manager/i)).toBeInTheDocument();
  });

  it("tapping Upload sends every staged photo in one batch and moves them into the sent grid", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    captureFromFileMock
      .mockResolvedValueOnce({ blob: new Blob(["a"]), qualityFlags: { blurry: false, tooDark: false } })
      .mockResolvedValueOnce({ blob: new Blob(["b"]), qualityFlags: { blurry: false, tooDark: false } });
    vi.mocked(addVehiclePhotos).mockResolvedValue([
      makePhoto({ id: "new-photo-1" }),
      makePhoto({ id: "new-photo-2" }),
    ]);
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/0 waiting on a manager/i);

    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, [
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]);
    await screen.findByText(/2 photos ready to upload/i);

    await user.click(screen.getByRole("button", { name: /upload 2 photos/i }));

    await waitFor(() =>
      expect(addVehiclePhotos).toHaveBeenCalledWith(
        "fake-token",
        "v1",
        expect.arrayContaining([
          expect.objectContaining({ blob: expect.anything() }),
          expect.objectContaining({ blob: expect.anything() }),
        ]),
        undefined, // no section picked -- optional, defaults to none
      ),
    );
    // One batched call, not one per photo.
    expect(addVehiclePhotos).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/2 waiting on a manager/i)).toBeInTheDocument());
    expect(screen.getByText(/2 photos uploaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/ready to upload/i)).not.toBeInTheDocument();
  });

  it("tapping a section chip before Upload sends that section with the batch, and resets after", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    vi.mocked(addVehiclePhotos).mockResolvedValue([makePhoto({ id: "new-photo-1" })]);
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/0 waiting on a manager/i);

    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, new File(["x"], "x.jpg", { type: "image/jpeg" }));
    await screen.findByText(/1 photo ready to upload/i);

    await user.click(screen.getByRole("button", { name: "Driver side" }));
    await user.click(screen.getByRole("button", { name: /upload 1 photo/i }));

    await waitFor(() =>
      expect(addVehiclePhotos).toHaveBeenCalledWith(
        "fake-token",
        "v1",
        expect.any(Array),
        "driver_side",
      ),
    );

    // The tag is per-batch, not a sticky setting -- a successful upload
    // resets it, so the next staged batch starts with nothing selected.
    await user.upload(input, new File(["y"], "y.jpg", { type: "image/jpeg" }));
    await screen.findByText(/1 photo ready to upload/i);
    expect(screen.queryByRole("button", { name: "Driver side" })).toHaveAttribute(
      "class",
      expect.not.stringContaining("bg-primary"),
    );
  });

  it("lets a staged photo be removed before uploading", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    captureFromFileMock.mockResolvedValue({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      qualityFlags: { blurry: false, tooDark: false },
    });
    const user = userEvent.setup();

    render(<MyVehicleDetailPageClient vehicleId="v1" />);
    await screen.findByText(/0 waiting on a manager/i);
    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, new File(["x"], "x.jpg", { type: "image/jpeg" }));
    await screen.findByText(/1 photo ready to upload/i);

    await user.click(screen.getByRole("button", { name: /remove photo/i }));

    expect(screen.queryByText(/ready to upload/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload 0 photos/i })).toBeDisabled();
  });

  it("shows an inline error when an upload fails, keeping the staged photos so nothing is lost", async () => {
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
    const input = screen.getByLabelText(/choose photos/i);
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: /upload 1 photo/i }));

    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
    // Still sitting in "ready to upload", not silently lost -- the user can retry.
    expect(screen.getByText(/1 photo ready to upload/i)).toBeInTheDocument();
    expect(screen.getByText(/1 waiting on a manager/i)).toBeInTheDocument();
  });
});
