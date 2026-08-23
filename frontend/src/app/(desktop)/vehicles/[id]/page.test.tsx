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
vi.mock("@/lib/api/parts", () => ({ listParts: vi.fn(), approvePart: vi.fn() }));
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
import { listParts, approvePart, type PartListItem } from "@/lib/api/parts";
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

const taxonomies: TaxonomyItemResponse[] = [
  { id: "tax-1", name: "Alternator", category: "Electrical", isQuickPick: true },
  { id: "tax-2", name: "Radiator", category: "Cooling", isQuickPick: false },
];

function makePart(overrides: Partial<PartListItem> = {}): PartListItem {
  return {
    id: "part-1",
    status: "pending_review",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: "Alternator",
    vehicle: null,
    photosCount: 1,
    firstImageId: null,
    latestAnalysis: null,
    ...overrides,
  };
}

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
    vi.mocked(listParts).mockReset();
    vi.mocked(approvePart).mockReset();
    vi.mocked(fetchVehiclePhotoBlob).mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    vi.mocked(fetchTaxonomy).mockResolvedValue(taxonomies);
    // Most tests don't care about parts -- default to empty so they don't
    // need their own mock, only the ones exercising the Parts section do.
    vi.mocked(listParts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 });
  });

  it("shows a distinguishable error state when loading fails", async () => {
    vi.mocked(getVehicle).mockRejectedValue(new Error("Request failed with status 500"));
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
  });

  it("shows the empty state when there are no photos", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByText(/no photos yet/i)).toBeInTheDocument();
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

  it("assigns selected photos to a chosen taxonomy, then keeps them selectable for a second part", async () => {
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
    // The photo can show more than one part (e.g. bumper + headlight in the
    // same frame) -- it must stay in the grid, marked as used, not vanish.
    expect(screen.getByTestId("unassigned-photo-photo-1")).toBeInTheDocument();
    expect(screen.getByTestId("unassigned-photo-photo-2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Used")).toBeInTheDocument());

    // And it's selectable again for a second part.
    await user.click(screen.getByTestId("unassigned-photo-photo-1"));
    expect(screen.getByRole("button", { name: /assign 1 photo/i })).toBeInTheDocument();
  });

  it("shows the AI suggestion label and pre-fills the taxonomy when a single suggested photo is selected", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([
      makePhoto({
        id: "photo-1",
        suggestions: [{ taxonomyId: "tax-1", taxonomyName: "Alternator", confidence: 0.92 }],
      }),
    ]);
    vi.mocked(assignVehiclePhotos).mockResolvedValue({ partId: "new-part-1" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="v1" />);
    await screen.findByTestId("unassigned-photo-photo-1");

    expect(screen.getByText(/suggested: alternator/i)).toBeInTheDocument();

    // Selecting the photo pre-fills the taxonomy from the suggestion --
    // Assign becomes usable without clicking any taxonomy button first.
    await user.click(screen.getByTestId("unassigned-photo-photo-1"));
    const assignButton = screen.getByRole("button", { name: /assign 1 photo/i });
    await waitFor(() => expect(assignButton).toBeEnabled());
    await user.click(assignButton);

    await waitFor(() =>
      expect(assignVehiclePhotos).toHaveBeenCalledWith("fake-token", "v1", ["photo-1"], "tax-1"),
    );
  });

  it("shows every suggestion for a photo with more than one, and pre-fills the highest-confidence one", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([
      makePhoto({
        id: "photo-1",
        suggestions: [
          { taxonomyId: "tax-1", taxonomyName: "Alternator", confidence: 0.7 },
          { taxonomyId: "tax-2", taxonomyName: "Radiator", confidence: 0.95 },
        ],
      }),
    ]);
    vi.mocked(assignVehiclePhotos).mockResolvedValue({ partId: "new-part-1" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="v1" />);
    await screen.findByTestId("unassigned-photo-photo-1");

    expect(screen.getByText(/suggested: alternator/i)).toBeInTheDocument();
    expect(screen.getByText(/suggested: radiator/i)).toBeInTheDocument();

    // Selecting the photo pre-fills the *highest*-confidence suggestion
    // (Radiator, 0.95) rather than the first one in the list.
    await user.click(screen.getByTestId("unassigned-photo-photo-1"));
    const assignButton = screen.getByRole("button", { name: /assign 1 photo/i });
    await waitFor(() => expect(assignButton).toBeEnabled());
    await user.click(assignButton);

    await waitFor(() =>
      expect(assignVehiclePhotos).toHaveBeenCalledWith("fake-token", "v1", ["photo-1"], "tax-2"),
    );
  });

  it("does not pre-fill a taxonomy for a photo with no AI suggestion", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" })]);
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="v1" />);
    await screen.findByTestId("unassigned-photo-photo-1");
    expect(screen.queryByText(/suggested:/i)).not.toBeInTheDocument();

    await user.click(screen.getByTestId("unassigned-photo-photo-1"));
    expect(screen.getByRole("button", { name: /assign 1 photo/i })).toBeDisabled();
  });

  it("disables Assign until both a photo and a taxonomy are selected", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([makePhoto({ id: "photo-1" })]);
    render(<VehicleDetailPageClient vehicleId="v1" />);

    await screen.findByTestId("unassigned-photo-photo-1");
    expect(screen.getByRole("button", { name: /assign 0 photo/i })).toBeDisabled();
  });

  it("shows 'not graded yet' when the vehicle has no analysis", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle({ latestVehicleAnalysis: null }));
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByText(/not graded yet/i)).toBeInTheDocument();
  });

  it("shows the grade, confidence, and damage codes once analysis completes", async () => {
    vi.mocked(getVehicle).mockResolvedValue(
      makeVehicle({
        latestVehicleAnalysis: {
          id: "va-1",
          grade: "B",
          damageCodes: ["rust", "dent"],
          confidence: 0.82,
          photoCount: 2,
          status: "complete",
          createdAt: new Date().toISOString(),
        },
      }),
    );
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);

    expect(await screen.findByText(/grade b/i)).toBeInTheDocument();
    expect(screen.getByText(/graded from 2 photos/i)).toBeInTheDocument();
    expect(screen.getByText(/82% confidence/i)).toBeInTheDocument();
    expect(screen.getByText("rust")).toBeInTheDocument();
    expect(screen.getByText("dent")).toBeInTheDocument();
  });

  it("shows a distinguishable failed-grading state", async () => {
    vi.mocked(getVehicle).mockResolvedValue(
      makeVehicle({
        latestVehicleAnalysis: {
          id: "va-1",
          grade: null,
          damageCodes: [],
          confidence: null,
          photoCount: 1,
          status: "failed",
          createdAt: new Date().toISOString(),
        },
      }),
    );
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    render(<VehicleDetailPageClient vehicleId="v1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/ai grading failed/i);
  });

  it("shows each part's AI grade, damage codes, and confidence -- this is what was missing before (only a bare status word)", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    vi.mocked(listParts).mockResolvedValue({
      items: [
        makePart({
          id: "part-1",
          taxonomyName: "Bumper Assy Front",
          latestAnalysis: {
            id: "a1",
            grade: "B",
            damageCodes: ["scratch", "faded paint"],
            confidence: 0.88,
            status: "complete",
          },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    });

    render(<VehicleDetailPageClient vehicleId="v1" />);

    expect(await screen.findByText("Bumper Assy Front")).toBeInTheDocument();
    expect(screen.getByText(/grade b/i)).toBeInTheDocument();
    expect(screen.getByText(/88% confidence/i)).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
    expect(screen.getByText("faded paint")).toBeInTheDocument();
  });

  it("approving a part calls the API and marks it approved without a second click", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    vi.mocked(listParts).mockResolvedValue({
      items: [
        makePart({
          id: "part-1",
          latestAnalysis: { id: "a1", grade: "A", damageCodes: [], confidence: 0.9, status: "complete" },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(approvePart).mockResolvedValue({ status: "approved" });
    const user = userEvent.setup();

    render(<VehicleDetailPageClient vehicleId="v1" />);
    const approveButton = await screen.findByRole("button", { name: /^approve$/i });
    await user.click(approveButton);

    await waitFor(() => expect(approvePart).toHaveBeenCalledWith("fake-token", "part-1"));
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it("shows 'grading in progress' for a part with no analysis yet, and a manual-grading note when it failed", async () => {
    vi.mocked(getVehicle).mockResolvedValue(makeVehicle());
    vi.mocked(listVehiclePhotos).mockResolvedValue([]);
    vi.mocked(listParts).mockResolvedValue({
      items: [
        makePart({ id: "part-pending", taxonomyName: "Hood", latestAnalysis: null }),
        makePart({
          id: "part-failed",
          taxonomyName: "Fender",
          status: "needs_manual_grading",
          latestAnalysis: { id: "a2", grade: null, damageCodes: [], confidence: null, status: "failed" },
        }),
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    });

    render(<VehicleDetailPageClient vehicleId="v1" />);

    expect(await screen.findByText(/grading in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/needs manual grading/i)).toBeInTheDocument();
  });
});
