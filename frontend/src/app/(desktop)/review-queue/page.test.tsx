import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewQueuePage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { PartListItem, PartListResult } from "@/lib/api/parts";

vi.mock("@/lib/api/parts", () => ({
  listParts: vi.fn(),
  approvePart: vi.fn(),
  regradePart: vi.fn(),
  mergeParts: vi.fn(),
  fetchPartImageBlob: vi.fn(),
}));
vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
}));
vi.mock("@/lib/api/corrections", () => ({
  recordCorrection: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  fetchTaxonomy: vi.fn(),
}));
vi.mock("@/lib/api/vehicles", () => ({
  listVehicles: vi.fn(),
  createManualPart: vi.fn(),
}));

import { approvePart, fetchPartImageBlob, listParts, mergeParts, regradePart } from "@/lib/api/parts";
import { getSettings } from "@/lib/api/settings";
import { recordCorrection } from "@/lib/api/corrections";
import { fetchTaxonomy } from "@/lib/api";
import { createManualPart, listVehicles } from "@/lib/api/vehicles";

function makePart(overrides: Partial<PartListItem> = {}): PartListItem {
  return {
    id: "part-1",
    status: "pending_review",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: "Alternator",
    vehicle: { id: "v1", vin: "VIN1234567890123", make: "Honda", model: "Accord", year: 2005 },
    photosCount: 1,
    firstImageId: null,
    latestPrice: null,
    latestAnalysis: {
      id: "part-1-analysis",
      grade: "B",
      damageCodes: ["scratch"],
      confidence: 0.9,
      status: "complete",
      damageUnits: null,
      araDamageCodes: null,
    },
    ...overrides,
  };
}

function makeListResult(items: PartListItem[]): PartListResult {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

describe("ReviewQueuePage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(listParts).mockReset();
    vi.mocked(approvePart).mockReset();
    vi.mocked(getSettings).mockReset();
    vi.mocked(recordCorrection).mockReset();
    vi.mocked(regradePart).mockReset();
    vi.mocked(mergeParts).mockReset();
    vi.mocked(fetchPartImageBlob).mockReset();
    vi.mocked(fetchTaxonomy).mockReset();
    vi.mocked(listVehicles).mockReset();
    vi.mocked(createManualPart).mockReset();
    vi.mocked(getSettings).mockResolvedValue({ aiConfidenceThreshold: 0.7 });
  });

  it("shows a distinguishable error state, not the empty state, when the queue fails to load", async () => {
    vi.mocked(listParts).mockRejectedValue(new Error("Request failed with status 500"));
    render(<ReviewQueuePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/nothing to review/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing needs review", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([]));
    render(<ReviewQueuePage />);
    expect(await screen.findByText(/nothing to review/i)).toBeInTheDocument();
  });

  it("fetches parts in pending_review and needs_manual_grading status", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([]));
    render(<ReviewQueuePage />);
    await waitFor(() => expect(listParts).toHaveBeenCalled());
    const [, params] = vi.mocked(listParts).mock.calls[0];
    expect(params?.status).toEqual(
      expect.arrayContaining(["pending_review", "needs_manual_grading"]),
    );
  });

  it("visually distinguishes a low-confidence item from a high-confidence one", async () => {
    const highConfidence = makePart({
      id: "high",
      latestAnalysis: { id: "high-analysis", grade: "A", damageCodes: [], confidence: 0.95, status: "complete", damageUnits: null, araDamageCodes: null },
    });
    const lowConfidence = makePart({
      id: "low",
      latestAnalysis: { id: "low-analysis", grade: "C", damageCodes: ["rust"], confidence: 0.3, status: "complete", damageUnits: null, araDamageCodes: null },
    });
    vi.mocked(listParts).mockResolvedValue(makeListResult([highConfidence, lowConfidence]));

    render(<ReviewQueuePage />);
    await screen.findByTestId("review-item-high");

    const lowCard = screen.getByTestId("review-item-low");
    const highCard = screen.getByTestId("review-item-high");
    expect(within(lowCard).getByText(/needs review/i)).toBeInTheDocument();
    expect(within(highCard).queryByText(/needs review/i)).not.toBeInTheDocument();
  });

  it("treats a failed analysis (no confidence at all) as needing review", async () => {
    const failed = makePart({
      id: "failed",
      status: "needs_manual_grading",
      latestAnalysis: { id: "failed-analysis", grade: null, damageCodes: [], confidence: null, status: "failed", damageUnits: null, araDamageCodes: null },
    });
    vi.mocked(listParts).mockResolvedValue(makeListResult([failed]));

    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-failed");
    expect(within(card).getByText(/needs review/i)).toBeInTheDocument();
  });

  it("approving without changing the grade approves without recording a correction", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([makePart()]));
    vi.mocked(approvePart).mockResolvedValue({ status: "approved" });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");
    await user.click(within(card).getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approvePart).toHaveBeenCalledWith("fake-token", "part-1"));
    expect(recordCorrection).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("review-item-part-1")).not.toBeInTheDocument());
  });

  it("changing the grade before approving records a correction, then approves", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([makePart()]));
    vi.mocked(recordCorrection).mockResolvedValue({ id: "correction-1" });
    vi.mocked(approvePart).mockResolvedValue({ status: "approved" });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");

    await user.selectOptions(within(card).getByLabelText(/grade/i), "A");
    await user.click(within(card).getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(recordCorrection).toHaveBeenCalledWith("fake-token", "part-1-analysis", "grade", "A"),
    );
    expect(approvePart).toHaveBeenCalledWith("fake-token", "part-1");
  });

  it("supports keyboard navigation between queue items with ArrowDown/ArrowUp", async () => {
    const partA = makePart({ id: "a" });
    const partB = makePart({ id: "b" });
    vi.mocked(listParts).mockResolvedValue(makeListResult([partA, partB]));
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await screen.findByTestId("review-item-a");

    expect(screen.getByTestId("review-item-a")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("review-item-b")).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{ArrowDown}");

    expect(screen.getByTestId("review-item-a")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("review-item-b")).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(screen.getByTestId("review-item-a")).toHaveAttribute("aria-selected", "true");
  });

  it("pressing 'a' approves the currently selected item", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([makePart()]));
    vi.mocked(approvePart).mockResolvedValue({ status: "approved" });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await screen.findByTestId("review-item-part-1");

    await user.keyboard("a");

    await waitFor(() => expect(approvePart).toHaveBeenCalledWith("fake-token", "part-1"));
  });

  it("shows the source photo thumbnail for a part AI graded from a photo", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-thumb-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    vi.mocked(fetchPartImageBlob).mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
    vi.mocked(listParts).mockResolvedValue(
      makeListResult([makePart({ firstImageId: "image-1" })]),
    );

    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");

    await waitFor(() =>
      expect(fetchPartImageBlob).toHaveBeenCalledWith("fake-token", "part-1", "image-1"),
    );
    // Thumbnail img is decorative (alt="") so it has no accessible "img" role -- query by tag instead.
    await waitFor(() =>
      expect(card.querySelector("img")).toHaveAttribute("src", "blob:mock-thumb-url"),
    );
  });

  it("does not show a thumbnail for a manually-added part with no photo", async () => {
    vi.mocked(listParts).mockResolvedValue(
      makeListResult([makePart({ firstImageId: null })]),
    );
    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");
    expect(card.querySelector("img")).not.toBeInTheDocument();
    expect(fetchPartImageBlob).not.toHaveBeenCalled();
  });

  it("re-grade button calls the regrade endpoint and shows a busy state while in flight", async () => {
    let resolveRegrade: (() => void) | undefined;
    vi.mocked(regradePart).mockReturnValue(
      new Promise((resolve) => {
        resolveRegrade = () => resolve({ status: "regrading" });
      }),
    );
    vi.mocked(listParts).mockResolvedValue(makeListResult([makePart()]));
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");
    await user.click(within(card).getByRole("button", { name: /^re-grade$/i }));

    expect(regradePart).toHaveBeenCalledWith("fake-token", "part-1");
    expect(within(card).getByRole("button", { name: /re-grading/i })).toBeDisabled();

    resolveRegrade?.();
    await waitFor(() => expect(within(card).getByRole("button", { name: /^re-grade$/i })).not.toBeDisabled());
  });

  it("does not show a re-grade button for a manually-added part with no photos", async () => {
    vi.mocked(listParts).mockResolvedValue(
      makeListResult([makePart({ photosCount: 0, latestAnalysis: null })]),
    );
    render(<ReviewQueuePage />);
    const card = await screen.findByTestId("review-item-part-1");
    expect(within(card).queryByRole("button", { name: /re-grade/i })).not.toBeInTheDocument();
  });

  it("Add a part: picking a vehicle and taxonomy creates a manual part and refreshes the queue", async () => {
    vi.mocked(listParts).mockResolvedValue(makeListResult([]));
    vi.mocked(listVehicles).mockResolvedValue({
      items: [
        {
          id: "veh-1",
          vin: "VIN1234567890123",
          make: "Honda",
          model: "Accord",
          year: 2005,
          trim: null,
          crushStatus: "active",
          createdAt: new Date().toISOString(),
          partsCount: 0,
          latestGrade: null,
          firstPhotoId: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 200,
    });
    vi.mocked(fetchTaxonomy).mockResolvedValue([
      { id: "tax-alt", name: "Alternator", category: "Electrical", isQuickPick: false },
    ]);
    vi.mocked(createManualPart).mockResolvedValue({ partId: "new-part-1" });
    const user = userEvent.setup();

    render(<ReviewQueuePage />);
    await screen.findByText(/nothing to review/i);

    await user.click(screen.getByRole("button", { name: /add a part/i }));
    await user.click(await screen.findByRole("button", { name: /Honda Accord.*VIN1234567890123/i }));
    await user.type(screen.getByLabelText(/search taxonomy/i), "Alt");
    await user.click(await screen.findByRole("button", { name: "Alternator" }));
    await user.click(screen.getByRole("button", { name: /^add part$/i }));

    await waitFor(() =>
      expect(createManualPart).toHaveBeenCalledWith("fake-token", "veh-1", "tax-alt"),
    );
    // Panel closes and the queue refetches after a successful add.
    await waitFor(() => expect(listParts).toHaveBeenCalledTimes(2));
  });

  describe("Merge duplicates", () => {
    it("shows a checkbox per item only once merge mode is toggled on", async () => {
      vi.mocked(listParts).mockResolvedValue(makeListResult([makePart()]));
      const user = userEvent.setup();

      render(<ReviewQueuePage />);
      const card = await screen.findByTestId("review-item-part-1");
      expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /merge duplicates/i }));
      expect(within(card).getByRole("checkbox")).toBeInTheDocument();
    });

    it("disables the merge action until two or more items are selected", async () => {
      const partA = makePart({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" });
      const partB = makePart({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" });
      vi.mocked(listParts).mockResolvedValue(makeListResult([partA, partB]));
      const user = userEvent.setup();

      render(<ReviewQueuePage />);
      await screen.findByTestId("review-item-a");
      await user.click(screen.getByRole("button", { name: /merge duplicates/i }));

      const mergeButton = screen.getByRole("button", { name: /merge \d* ?parts/i });
      expect(mergeButton).toBeDisabled();

      await user.click(within(screen.getByTestId("review-item-a")).getByRole("checkbox"));
      expect(mergeButton).toBeDisabled();

      await user.click(within(screen.getByTestId("review-item-b")).getByRole("checkbox"));
      expect(mergeButton).not.toBeDisabled();
    });

    it("merges the selected parts into the earliest-created one, then refreshes the queue", async () => {
      const older = makePart({
        id: "older",
        createdAt: "2026-01-01T00:00:00.000Z",
        vehicle: { id: "v1", vin: "VIN1234567890123", make: "Honda", model: "Accord", year: 2005 },
      });
      const newer = makePart({
        id: "newer",
        createdAt: "2026-01-05T00:00:00.000Z",
        vehicle: { id: "v1", vin: "VIN1234567890123", make: "Honda", model: "Accord", year: 2005 },
      });
      vi.mocked(listParts).mockResolvedValue(makeListResult([older, newer]));
      vi.mocked(mergeParts).mockResolvedValue({
        id: "older",
        status: "pending_review",
        createdAt: older.createdAt,
        taxonomyId: "tax-1",
        taxonomyName: "Alternator",
        vehicle: older.vehicle,
        photos: [],
        latestAnalysis: null,
      });
      const user = userEvent.setup();

      render(<ReviewQueuePage />);
      await screen.findByTestId("review-item-older");
      await user.click(screen.getByRole("button", { name: /merge duplicates/i }));
      await user.click(within(screen.getByTestId("review-item-older")).getByRole("checkbox"));
      await user.click(within(screen.getByTestId("review-item-newer")).getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: /merge \d* ?parts/i }));

      await waitFor(() =>
        expect(mergeParts).toHaveBeenCalledWith("fake-token", "older", ["newer"]),
      );
      // Merge mode exits and the queue refetches after a successful merge.
      await waitFor(() => expect(listParts).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("disables the merge action and warns when selected parts span different vehicles", async () => {
      const onVehicleA = makePart({
        id: "a",
        vehicle: { id: "v1", vin: "VIN1234567890123", make: "Honda", model: "Accord", year: 2005 },
      });
      const onVehicleB = makePart({
        id: "b",
        vehicle: { id: "v2", vin: "OTHERVIN1234567", make: "Ford", model: "Focus", year: 2010 },
      });
      vi.mocked(listParts).mockResolvedValue(makeListResult([onVehicleA, onVehicleB]));
      const user = userEvent.setup();

      render(<ReviewQueuePage />);
      await screen.findByTestId("review-item-a");
      await user.click(screen.getByRole("button", { name: /merge duplicates/i }));
      await user.click(within(screen.getByTestId("review-item-a")).getByRole("checkbox"));
      await user.click(within(screen.getByTestId("review-item-b")).getByRole("checkbox"));

      expect(screen.getByText(/same vehicle/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /merge \d* ?parts/i })).toBeDisabled();
      expect(mergeParts).not.toHaveBeenCalled();
    });
  });
});
