import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewQueuePage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { PartListItem, PartListResult } from "@/lib/api/parts";

vi.mock("@/lib/api/parts", () => ({
  listParts: vi.fn(),
  approvePart: vi.fn(),
}));
vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
}));
vi.mock("@/lib/api/corrections", () => ({
  recordCorrection: vi.fn(),
}));

import { approvePart, listParts } from "@/lib/api/parts";
import { getSettings } from "@/lib/api/settings";
import { recordCorrection } from "@/lib/api/corrections";

function makePart(overrides: Partial<PartListItem> = {}): PartListItem {
  return {
    id: "part-1",
    status: "pending_review",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: "Alternator",
    vehicle: { id: "v1", vin: "VIN1234567890123", make: "Honda", model: "Accord", year: 2005 },
    photosCount: 1,
    latestAnalysis: {
      id: "part-1-analysis",
      grade: "B",
      damageCodes: ["scratch"],
      confidence: 0.9,
      status: "complete",
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
    vi.mocked(getSettings).mockResolvedValue({ aiConfidenceThreshold: 0.7 });
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
      latestAnalysis: { id: "high-analysis", grade: "A", damageCodes: [], confidence: 0.95, status: "complete" },
    });
    const lowConfidence = makePart({
      id: "low",
      latestAnalysis: { id: "low-analysis", grade: "C", damageCodes: ["rust"], confidence: 0.3, status: "complete" },
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
      latestAnalysis: { id: "failed-analysis", grade: null, damageCodes: [], confidence: null, status: "failed" },
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
});
