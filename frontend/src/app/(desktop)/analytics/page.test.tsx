import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { AnalyticsSummary } from "@/lib/api/analytics";

vi.mock("@/lib/api/analytics", () => ({ getAnalytics: vi.fn() }));
import { getAnalytics } from "@/lib/api/analytics";

function makeSummary(overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    totalVehicles: 5,
    totalParts: 9,
    partsByStatus: { approved: 3, pending_review: 4, listed: 2 },
    gradeDistribution: { A: 2, B: 1, C: 1 },
    vehiclesByCrushStatus: { active: 3, stripped: 1, crushed: 1 },
    ...overrides,
  };
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(getAnalytics).mockReset();
  });

  it("shows total vehicles and parts", async () => {
    vi.mocked(getAnalytics).mockResolvedValue(makeSummary());
    render(<AnalyticsPage />);
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("breaks down parts by status", async () => {
    vi.mocked(getAnalytics).mockResolvedValue(makeSummary());
    render(<AnalyticsPage />);
    await screen.findByText(/pending review/i);
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it("breaks down grade distribution", async () => {
    vi.mocked(getAnalytics).mockResolvedValue(makeSummary());
    render(<AnalyticsPage />);
    const gradeA = await screen.findByTestId("grade-A");
    expect(gradeA).toHaveTextContent("2");
  });

  it("handles an empty tenant gracefully", async () => {
    vi.mocked(getAnalytics).mockResolvedValue(
      makeSummary({ totalVehicles: 0, totalParts: 0, partsByStatus: {}, gradeDistribution: {}, vehiclesByCrushStatus: {} }),
    );
    render(<AnalyticsPage />);
    expect(await screen.findByText(/no data yet/i)).toBeInTheDocument();
  });
});
