import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InventoryPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { PartListItem, PartListResult } from "@/lib/api/parts";

vi.mock("@/lib/api/parts", () => ({ listParts: vi.fn() }));
import { listParts } from "@/lib/api/parts";

function makePart(i: number): PartListItem {
  return {
    id: `part-${i}`,
    status: i % 3 === 0 ? "approved" : "pending_ai",
    createdAt: new Date().toISOString(),
    taxonomyId: "tax-1",
    taxonomyName: `Part ${i}`,
    vehicle: { id: "v1", vin: `VIN${i.toString().padStart(10, "0")}`, make: "Honda", model: "Accord", year: 2005 },
    photosCount: 1,
    firstImageId: null,
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
});
