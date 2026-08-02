import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "./page";
import { useAuthSession } from "@/lib/auth-session";

vi.mock("@/lib/api/vehicles", () => ({ listVehicles: vi.fn() }));
vi.mock("@/lib/api/parts", () => ({ listParts: vi.fn() }));

import { listParts } from "@/lib/api/parts";
import { listVehicles } from "@/lib/api/vehicles";

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe("DashboardPage", () => {
  beforeEach(() => {
    const token = makeJwt({ sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" });
    useAuthSession.setState({ token, claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" }, restored: true });
    vi.mocked(listVehicles).mockReset();
    vi.mocked(listParts).mockReset();
  });

  it("shows vehicle, review-queue, and marketplace-ready counts", async () => {
    vi.mocked(listVehicles).mockResolvedValue({ items: [], total: 42, page: 1, pageSize: 1 });
    vi.mocked(listParts).mockImplementation((_token, params) => {
      if (params?.status?.includes("pending_review")) {
        return Promise.resolve({ items: [], total: 7, page: 1, pageSize: 1 });
      }
      return Promise.resolve({ items: [], total: 15, page: 1, pageSize: 1 });
    });

    render(<DashboardPage />);

    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(await screen.findByText("15")).toBeInTheDocument();
  });

  it("shows a distinguishable error banner, not a silent zero, when a stat fails to load", async () => {
    vi.mocked(listVehicles).mockRejectedValue(new Error("Request failed with status 500"));
    vi.mocked(listParts).mockRejectedValue(new Error("Request failed with status 500"));

    render(<DashboardPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
  });

  it("links the review-queue stat to the review queue screen", async () => {
    vi.mocked(listVehicles).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1 });
    vi.mocked(listParts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1 });

    render(<DashboardPage />);

    const link = await screen.findByRole("link", { name: /needs review/i });
    expect(link).toHaveAttribute("href", "/review-queue");
  });
});
