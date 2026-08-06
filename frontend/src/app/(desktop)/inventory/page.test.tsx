import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InventoryPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { PartDetail, PartListItem, PartListResult } from "@/lib/api/parts";

vi.mock("@/lib/api/parts", () => ({ listParts: vi.fn(), getPart: vi.fn() }));
import { getPart, listParts } from "@/lib/api/parts";

vi.mock("@/lib/api/corrections", () => ({ recordCorrection: vi.fn() }));
import { recordCorrection } from "@/lib/api/corrections";

// Object-URL fetching/rendering is PartPhoto's own concern -- stub it here
// so this file only tests Inventory's click-to-view-detail wiring.
vi.mock("@/components/desktop/part-photo", () => ({
  PartPhoto: ({ imageId }: { imageId: string }) => <div data-testid={`part-photo-${imageId}`}>photo</div>,
}));

function makePart(i: number): PartListItem {
  return {
    id: `part-${i}`,
    status: i % 3 === 0 ? "approved" : "pending_ai",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: `Part ${i}`,
    vehicle: { id: "v1", vin: `VIN${i.toString().padStart(10, "0")}`, make: "Honda", model: "Accord", year: 2005 },
    photosCount: 1,
    latestAnalysis: null,
  };
}

describe("InventoryPage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(listParts).mockReset();
    vi.mocked(getPart).mockReset();
    vi.mocked(recordCorrection).mockReset();

    // jsdom performs no real layout -- @tanstack/react-virtual needs a
    // non-zero viewport to compute which rows are actually visible, and
    // ResizeObserver doesn't exist in jsdom at all.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // @tanstack/react-virtual measures offsetHeight/offsetWidth (not
    // clientHeight) to size the viewport -- jsdom always reports 0 for both.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 800,
    });
  });

  it("shows a distinguishable error state, not the empty state, when inventory fails to load", async () => {
    vi.mocked(listParts).mockRejectedValue(new Error("Request failed with status 500"));
    render(<InventoryPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/no parts in inventory/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when there is no inventory yet", async () => {
    vi.mocked(listParts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1000 });
    render(<InventoryPage />);
    expect(await screen.findByText(/no parts in inventory/i)).toBeInTheDocument();
  });

  it("only renders a small, bounded number of row elements for a 10,000-item dataset (virtualization is actually active)", async () => {
    const items = Array.from({ length: 10000 }, (_, i) => makePart(i));
    const result: PartListResult = { items, total: items.length, page: 1, pageSize: 10000 };
    vi.mocked(listParts).mockResolvedValue(result);

    render(<InventoryPage />);

    await screen.findByText("Part 0");

    const rows = screen.getAllByRole("row");
    // Far fewer than 10,000 -- proves only the visible window (+ overscan)
    // is actually in the DOM, not the whole dataset.
    expect(rows.length).toBeLessThan(50);
  });

  it("filters by status", async () => {
    const items = [makePart(1), makePart(2), makePart(3)];
    vi.mocked(listParts).mockResolvedValue({ items, total: 3, page: 1, pageSize: 1000 });
    const user = userEvent.setup();

    render(<InventoryPage />);
    await screen.findByText("Part 1");

    await user.selectOptions(screen.getByLabelText(/status/i), "approved");

    await waitFor(() =>
      expect(listParts).toHaveBeenLastCalledWith(
        "fake-token",
        expect.objectContaining({ status: ["approved"] }),
      ),
    );
  });

  it("clicking a row shows its photos and lets a manager change and save the grade", async () => {
    const items = [makePart(1)];
    vi.mocked(listParts).mockResolvedValue({ items, total: 1, page: 1, pageSize: 1000 });
    const detail: PartDetail = {
      id: "part-1",
      status: "pending_review",
      createdAt: new Date().toISOString(),
      taxonomyId: "tax-1",
      taxonomyName: "Part 1",
      vehicle: null,
      photos: [{ id: "photo-1", url: "part-1/photo-1.jpg" }],
      latestAnalysis: {
        id: "analysis-1",
        grade: "C",
        damageCodes: ["scratch"],
        confidence: 0.6,
        status: "complete",
        rawJson: null,
      },
    };
    vi.mocked(getPart).mockResolvedValue(detail);
    vi.mocked(recordCorrection).mockResolvedValue({ id: "correction-1" });
    const user = userEvent.setup();

    render(<InventoryPage />);
    await user.click(await screen.findByText("Part 1"));

    expect(await screen.findByTestId("part-photo-photo-1")).toBeInTheDocument();
    expect(getPart).toHaveBeenCalledWith("fake-token", "part-1");

    const gradeSelect = await screen.findByLabelText(/grade/i);
    await user.selectOptions(gradeSelect, "A");
    await user.click(screen.getByRole("button", { name: /save grade/i }));

    await waitFor(() =>
      expect(recordCorrection).toHaveBeenCalledWith("fake-token", "analysis-1", "grade", "A"),
    );
  });
});
