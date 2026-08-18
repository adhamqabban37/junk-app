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
    photoIds: [`photo-${i}`],
    photosCount: 1,
    latestAnalysis: null,
  };
}

/** A part with a real taxonomy name, for the family-grouping tests. */
function makeNamedPart(id: string, taxonomyName: string, photoIds: string[] = []): PartListItem {
  return {
    id,
    status: "pending_ai",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName,
    vehicle: null,
    photoIds,
    photosCount: photoIds.length,
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

  describe("family grouping", () => {
    const FOUR_DOORS = [
      makeNamedPart("d1", "Door (Passenger Rear)"),
      makeNamedPart("d2", "Door (Driver Front)"),
      makeNamedPart("d3", "Door (Passenger Front)"),
      makeNamedPart("d4", "Door (Driver Rear)"),
    ];

    it("puts a family's parts under one heading, in physical order", async () => {
      vi.mocked(listParts).mockResolvedValue({ items: FOUR_DOORS, total: 4, page: 1, pageSize: 1000 });

      render(<InventoryPage />);

      expect(await screen.findByRole("rowheader", { name: /doors/i })).toBeInTheDocument();
      const labels = (await screen.findAllByTestId(/^inventory-position-/)).map((el) => el.textContent);
      expect(labels).toEqual(["Front Left", "Front Right", "Rear Left", "Rear Right"]);
    });

    it("does not put a heading on a family holding a single part", async () => {
      vi.mocked(listParts).mockResolvedValue({
        items: [makeNamedPart("a1", "Alternator")],
        total: 1,
        page: 1,
        pageSize: 1000,
      });

      render(<InventoryPage />);

      expect(await screen.findByText("Alternator")).toBeInTheDocument();
      expect(screen.queryByRole("rowheader")).not.toBeInTheDocument();
    });

    /**
     * Grouping must not quietly cost the virtualization the flat list had.
     * A yard's inventory is large, which is why PAGE_SIZE is 1000 and the
     * list is virtualized in the first place.
     */
    it("stays virtualized once grouped", async () => {
      const items = Array.from({ length: 10000 }, (_, i) => makePart(i));
      vi.mocked(listParts).mockResolvedValue({ items, total: items.length, page: 1, pageSize: 10000 });

      render(<InventoryPage />);
      await screen.findByText("Part 0");

      expect(screen.getAllByRole("row").length).toBeLessThan(50);
    });

    it("shows the whole group's photos in the grid when a heading is selected", async () => {
      const doors = [
        makeNamedPart("d1", "Door (Driver Front)", ["ph-1"]),
        makeNamedPart("d2", "Door (Passenger Front)", ["ph-2"]),
      ];
      vi.mocked(listParts).mockResolvedValue({ items: doors, total: 2, page: 1, pageSize: 1000 });
      const user = userEvent.setup();

      render(<InventoryPage />);
      await user.click(await screen.findByRole("rowheader", { name: /doors/i }));

      expect(await screen.findByTestId("part-photo-ph-1")).toBeInTheDocument();
      expect(screen.getByTestId("part-photo-ph-2")).toBeInTheDocument();
    });

    it("narrows the grid to one part when that part is selected", async () => {
      const doors = [
        makeNamedPart("d1", "Door (Driver Front)", ["ph-1"]),
        makeNamedPart("d2", "Door (Passenger Front)", ["ph-2"]),
      ];
      vi.mocked(listParts).mockResolvedValue({ items: doors, total: 2, page: 1, pageSize: 1000 });
      vi.mocked(getPart).mockResolvedValue({
        id: "d1",
        status: "pending_ai",
        createdAt: new Date().toISOString(),
        taxonomyId: "tax-1",
        taxonomyName: "Door (Driver Front)",
        vehicle: null,
        photos: [{ id: "ph-1", url: "d1/ph-1.jpg" }],
        latestAnalysis: null,
      } as PartDetail);
      const user = userEvent.setup();

      render(<InventoryPage />);
      await user.click(await screen.findByTestId("inventory-row-d1"));

      expect(await screen.findByTestId("part-photo-ph-1")).toBeInTheDocument();
      expect(screen.queryByTestId("part-photo-ph-2")).not.toBeInTheDocument();
    });

    it("shows the asked-for Front/Left wording, not the stored Driver/Passenger", async () => {
      // Storage stays Driver/Passenger on purpose -- TaxonomyMatcher and the
      // Car-Part export boundary depend on it. Only the display translates.
      vi.mocked(listParts).mockResolvedValue({ items: FOUR_DOORS, total: 4, page: 1, pageSize: 1000 });

      render(<InventoryPage />);
      await screen.findByRole("rowheader", { name: /doors/i });

      expect(screen.queryByText(/driver/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/passenger/i)).not.toBeInTheDocument();
    });
  });
});
