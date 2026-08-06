import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VehicleDetailPageClient from "./vehicle-detail-page-client";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleDetail } from "@/lib/api/vehicles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/api/vehicles", () => ({
  getVehicle: vi.fn(),
  addVehicleImage: vi.fn(),
  addPartImage: vi.fn(),
}));
import { addPartImage, addVehicleImage, getVehicle } from "@/lib/api/vehicles";

// Object-URL fetching is VehiclePhoto's own concern.
vi.mock("@/components/mobile/vehicle-photo", () => ({
  VehiclePhoto: ({ angle }: { angle: string }) => <div data-testid={`photo-${angle}`} />,
}));

// The real one runs the canvas blur/lighting pipeline, which jsdom has no
// 2d context for.
vi.mock("@/lib/offline/capture", () => ({
  captureFromFile: vi.fn().mockResolvedValue({
    blob: new Blob(["x"], { type: "image/jpeg" }),
    qualityFlags: { blurry: false, tooDark: false },
  }),
}));

function makeDetail(overrides: Partial<VehicleDetail> = {}): VehicleDetail {
  return {
    id: "veh-1",
    vin: "1HGCM82633A004352",
    make: "Honda",
    model: "Accord",
    year: 2003,
    trim: null,
    crushStatus: "active",
    createdAt: new Date().toISOString(),
    partsCount: 1,
    images: [{ id: "img-1", angle: "front", url: "front.jpg" }],
    parts: [
      {
        id: "part-1",
        status: "pending_review",
        taxonomyId: "tax-1",
        taxonomyName: "Alternator",
        photosCount: 1,
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

describe("VehicleDetailPageClient", () => {
  beforeEach(() => {
    vi.mocked(getVehicle).mockReset();
    vi.mocked(addVehicleImage).mockReset();
    vi.mocked(addPartImage).mockReset();
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "w1", tenantId: "t1", role: "worker", name: "Worker A" },
      restored: true,
    });
  });

  it("previews the vehicle's existing exterior photos and parts", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());

    render(<VehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByText("2003 Honda Accord")).toBeInTheDocument();
    expect(screen.getByTestId("photo-front")).toBeInTheDocument();
    expect(screen.getByText("Alternator")).toBeInTheDocument();
    // Status and photo count are what tell the attendant whether a re-shoot
    // is what this part needs.
    expect(screen.getByText(/pending review · 1 photo/i)).toBeInTheDocument();
  });

  it("uploads an added exterior photo against the chosen angle and reloads", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addVehicleImage).mockResolvedValue({ id: "img-2", angle: "rear", url: "rear.jpg" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add rear/i }));

    const input = screen.getByLabelText(/choose photo/i);
    await user.upload(input, new File(["x"], "rear.jpg", { type: "image/jpeg" }));

    await vi.waitFor(() =>
      expect(addVehicleImage).toHaveBeenCalledWith(
        "fake-token",
        "veh-1",
        "rear",
        expect.any(Blob),
      ),
    );
    // Reloaded so the new photo appears without a manual refresh.
    await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledTimes(2));
  });

  it("adds a re-shot photo to an existing part", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addPartImage).mockResolvedValue({ id: "pimg-2", url: "p.jpg" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add photo/i }));

    await user.upload(
      screen.getByLabelText(/choose photo/i),
      new File(["x"], "p.jpg", { type: "image/jpeg" }),
    );

    await vi.waitFor(() =>
      expect(addPartImage).toHaveBeenCalledWith("fake-token", "part-1", expect.any(Blob)),
    );
  });

  it("surfaces an upload failure instead of silently doing nothing", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addVehicleImage).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add rear/i }));
    await user.upload(
      screen.getByLabelText(/choose photo/i),
      new File(["x"], "rear.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t upload/i);
  });

  it("shows a retryable error state when the vehicle can't be loaded", async () => {
    vi.mocked(getVehicle).mockRejectedValue(new Error("boom"));

    render(<VehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
