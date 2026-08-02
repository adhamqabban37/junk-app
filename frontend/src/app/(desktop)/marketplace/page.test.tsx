import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketplacePage from "./page";
import { useAuthSession } from "@/lib/auth-session";

vi.mock("@/lib/api/parts", () => ({
  listParts: vi.fn(),
  exportPartsCsvUrl: vi.fn(),
}));
import { listParts, exportPartsCsvUrl } from "@/lib/api/parts";

describe("MarketplacePage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(listParts).mockReset();
    vi.mocked(exportPartsCsvUrl).mockReset();
    vi.mocked(listParts).mockResolvedValue({ items: [], total: 12, page: 1, pageSize: 1 });
  });

  it("shows a distinguishable error, not a silent 0, when the count fails to load", async () => {
    vi.mocked(listParts).mockReset();
    vi.mocked(listParts).mockRejectedValue(new Error("Request failed with status 500"));
    render(<MarketplacePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
  });

  it("shows how many parts are marketplace-ready", async () => {
    render(<MarketplacePage />);
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(listParts).toHaveBeenCalledWith(
      "fake-token",
      expect.objectContaining({ status: ["approved", "listed"] }),
    );
  });

  it("downloads a CSV file when the export button is clicked", async () => {
    const blob = new Blob(["id,vin\n1,VIN1"], { type: "text/csv" });
    vi.mocked(exportPartsCsvUrl).mockResolvedValue(blob);
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();

    render(<MarketplacePage />);
    await screen.findByText("12");
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    await waitFor(() => expect(exportPartsCsvUrl).toHaveBeenCalledWith("fake-token"));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();

    clickSpy.mockRestore();
  });

  it("shows an error if the export fails", async () => {
    vi.mocked(exportPartsCsvUrl).mockRejectedValue(new Error("CSV export failed with status 500"));
    const user = userEvent.setup();

    render(<MarketplacePage />);
    await screen.findByText("12");
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(await screen.findByText(/couldn.t export/i)).toBeInTheDocument();
  });
});
