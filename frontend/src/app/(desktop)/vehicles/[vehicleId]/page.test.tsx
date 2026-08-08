import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagerVehicleDetailPageClient from "./vehicle-detail-page-client";
import { useAuthSession } from "@/lib/auth-session";
import type { VehicleDetail, VehicleDetailPart } from "@/lib/api/vehicles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/api/vehicles", () => ({
  getVehicle: vi.fn(),
  addVehicleImage: vi.fn(),
  addPartImage: vi.fn(),
  scanVehicle: vi.fn(),
}));
import {
  addPartImage,
  addVehicleImage,
  getVehicle,
  scanVehicle,
} from "@/lib/api/vehicles";
import type { VehicleScanSummary } from "@/lib/api/vehicles";

function makeScan(overrides: Partial<VehicleScanSummary> = {}): VehicleScanSummary {
  return {
    vehicleId: "veh-1",
    partsCreated: 3,
    partsUpdated: 0,
    needsGrading: 0,
    photos: [
      { index: 0, clarity: "clear", note: "good light", detections: 3 },
    ],
    unresolved: [],
    roster: {
      expected: ["Hood", "Fender (Left)", "Fender (Right)"],
      found: ["Hood", "Fender (Left)"],
      missing: ["Fender (Right)"],
      approximate: false,
      doors: 4,
      bodyClass: "Sedan/Saloon",
    },
    ...overrides,
  };
}

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

function makePart(overrides: Partial<VehicleDetailPart> = {}): VehicleDetailPart {
  return {
    id: "part-1",
    status: "pending_review",
    taxonomyId: "tax-1",
    taxonomyName: "Alternator",
    photosCount: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

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
    parts: [makePart()],
    ...overrides,
  };
}

describe("ManagerVehicleDetailPageClient", () => {
  beforeEach(() => {
    vi.mocked(getVehicle).mockReset();
    vi.mocked(addVehicleImage).mockReset();
    vi.mocked(addPartImage).mockReset();
    vi.mocked(scanVehicle).mockReset();
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
  });

  it("shows the vehicle's exterior photos and parts", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByText("2003 Honda Accord")).toBeInTheDocument();
    expect(screen.getByText("1HGCM82633A004352")).toBeInTheDocument();
    expect(screen.getByTestId("photo-front")).toBeInTheDocument();
    expect(screen.getByText("Alternator")).toBeInTheDocument();
  });

  // The whole point of the screen: a manager has to be able to see *which*
  // parts are missing photos, because those are the ones that can never be
  // graded until someone adds one.
  it("calls out parts that have no photo and cannot be graded", async () => {
    vi.mocked(getVehicle).mockResolvedValue(
      makeDetail({
        parts: [
          makePart({ id: "part-1", taxonomyName: "Alternator", photosCount: 1 }),
          makePart({
            id: "part-2",
            taxonomyName: "Bumper (Rear)",
            photosCount: 0,
            status: "pending_ai",
          }),
        ],
      }),
    );

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    // A summary so it's visible without reading every row.
    expect(await screen.findByTestId("missing-photos-summary")).toHaveTextContent(
      /1 part has no photo/i,
    );

    const needy = screen.getByTestId("part-row-part-2");
    expect(within(needy).getByText(/no photos/i)).toBeInTheDocument();

    // The part that already has a photo must not be flagged.
    const fine = screen.getByTestId("part-row-part-1");
    expect(within(fine).queryByText(/no photos/i)).not.toBeInTheDocument();
  });

  it("does not show the missing-photo summary when every part has a photo", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    await screen.findByText("Alternator");
    expect(screen.queryByTestId("missing-photos-summary")).not.toBeInTheDocument();
  });

  it("adds a photo to a part and reloads so the new count shows", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addPartImage).mockResolvedValue({ id: "pimg-2", url: "p.jpg" });
    const user = userEvent.setup();

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add photo/i }));

    await user.upload(
      screen.getByLabelText(/choose photo/i),
      new File(["x"], "p.jpg", { type: "image/jpeg" }),
    );

    await vi.waitFor(() =>
      expect(addPartImage).toHaveBeenCalledWith("fake-token", "part-1", expect.any(Blob)),
    );
    await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledTimes(2));
  });

  // Adding a part photo enqueues a fresh AI grading job, and
  // AiAnalysisService sets the part back to pending_review on success --
  // i.e. an already-approved part reappears in the Review Queue. The manager
  // should not have to discover that by watching it happen.
  it("tells the manager that adding a part photo re-grades it", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByText(/re-?grad/i)).toBeInTheDocument();
  });

  it("uploads an added exterior photo against the chosen angle", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addVehicleImage).mockResolvedValue({ id: "img-2", angle: "rear", url: "rear.jpg" });
    const user = userEvent.setup();

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add rear/i }));

    await user.upload(
      screen.getByLabelText(/choose photo/i),
      new File(["x"], "rear.jpg", { type: "image/jpeg" }),
    );

    await vi.waitFor(() =>
      expect(addVehicleImage).toHaveBeenCalledWith(
        "fake-token",
        "veh-1",
        "rear",
        expect.any(Blob),
      ),
    );
  });

  it("surfaces an upload failure instead of silently doing nothing", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());
    vi.mocked(addPartImage).mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
    await user.click(await screen.findByRole("button", { name: /add photo/i }));
    await user.upload(
      screen.getByLabelText(/choose photo/i),
      new File(["x"], "p.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t upload/i);
  });

  it("shows a retryable error state when the vehicle can't be loaded", async () => {
    vi.mocked(getVehicle).mockRejectedValue(new Error("boom"));

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  describe("AI part scan", () => {
    it("scans the photos already on the vehicle without an upload", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail());
      vi.mocked(scanVehicle).mockResolvedValue(makeScan());
      const user = userEvent.setup();

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
      await user.click(await screen.findByRole("button", { name: /scan the 1 photo/i }));

      await vi.waitFor(() =>
        expect(scanVehicle).toHaveBeenCalledWith("fake-token", "veh-1", {
          useExistingImages: true,
        }),
      );
      // Reloaded so the newly-created parts appear without a refresh.
      await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledTimes(2));
    });

    it("reports what the scan identified and graded", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail());
      vi.mocked(scanVehicle).mockResolvedValue(makeScan());
      const user = userEvent.setup();

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
      await user.click(await screen.findByRole("button", { name: /scan the 1 photo/i }));

      const result = await screen.findByTestId("scan-result");
      expect(result).toHaveTextContent(/3 new parts identified and graded/i);
      // The VIN checklist: how many parts this vehicle should have.
      expect(screen.getByTestId("scan-roster")).toHaveTextContent(
        /2 of 3 expected exterior parts/i,
      );
      expect(screen.getByTestId("scan-roster")).toHaveTextContent(/Fender \(Right\)/);
    });

    // The user's explicit ask: say when a photo isn't clear, but still work
    // with whatever it produced.
    it("warns about an unclear photo without discarding its parts", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail());
      vi.mocked(scanVehicle).mockResolvedValue(
        makeScan({
          partsCreated: 2,
          needsGrading: 1,
          photos: [
            {
              index: 0,
              clarity: "poor",
              note: "blurry and backlit",
              detections: 2,
            },
          ],
        }),
      );
      const user = userEvent.setup();

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
      await user.click(await screen.findByRole("button", { name: /scan the 1 photo/i }));

      const photo = await screen.findByTestId("scan-photo-0");
      expect(photo).toHaveTextContent(/hard to read/i);
      expect(photo).toHaveTextContent(/blurry and backlit/i);
      // Still counted, not thrown away.
      expect(photo).toHaveTextContent(/2 parts found/i);
      expect(screen.getByTestId("scan-result")).toHaveTextContent(
        /1 part needs a person to grade/i,
      );
    });

    it("shows what the AI saw but could not file, rather than dropping it", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail());
      vi.mocked(scanVehicle).mockResolvedValue(
        makeScan({
          unresolved: [
            {
              partName: "fender",
              candidateIds: ["a", "b"],
              reason: "ambiguous",
              grade: "B",
              confidence: 0.9,
              photoIndex: 0,
            },
            {
              partName: "catalytic converter",
              candidateIds: [],
              reason: "unmapped",
              grade: "A",
              confidence: 0.8,
              photoIndex: 0,
            },
          ],
        }),
      );
      const user = userEvent.setup();

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
      await user.click(await screen.findByRole("button", { name: /scan the 1 photo/i }));

      const unresolved = await screen.findByTestId("scan-unresolved");
      expect(unresolved).toHaveTextContent(/couldn.t tell which side/i);
      expect(unresolved).toHaveTextContent(/no matching part type/i);
      expect(unresolved).toHaveTextContent(/catalytic converter/i);
    });

    it("surfaces a failed scan instead of looking like it did nothing", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail());
      vi.mocked(scanVehicle).mockRejectedValue(new Error("offline"));
      const user = userEvent.setup();

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);
      await user.click(await screen.findByRole("button", { name: /scan the 1 photo/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t scan/i);
    });

    it("cannot scan stored photos when the vehicle has none", async () => {
      vi.mocked(getVehicle).mockResolvedValue(makeDetail({ images: [] }));

      render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

      expect(
        await screen.findByRole("button", { name: /scan the 0 photos/i }),
      ).toBeDisabled();
    });
  });

  it("links back to the vehicles list", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeDetail());

    render(<ManagerVehicleDetailPageClient vehicleId="veh-1" />);

    expect(await screen.findByRole("link", { name: /vehicles/i })).toHaveAttribute(
      "href",
      "/vehicles",
    );
  });
});
