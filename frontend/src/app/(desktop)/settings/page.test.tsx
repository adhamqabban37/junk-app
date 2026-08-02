import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { useAuthSession } from "@/lib/auth-session";

vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
import { getSettings, updateSettings } from "@/lib/api/settings";

describe("SettingsPage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(getSettings).mockReset();
    vi.mocked(updateSettings).mockReset();
    vi.mocked(getSettings).mockResolvedValue({ aiConfidenceThreshold: 0.7 });
  });

  it("loads and displays the current AI confidence threshold", async () => {
    render(<SettingsPage />);
    const input = await screen.findByLabelText(/ai confidence threshold/i);
    expect(input).toHaveValue(70);
  });

  it("saves an updated threshold", async () => {
    vi.mocked(updateSettings).mockResolvedValue({ aiConfidenceThreshold: 0.85 });
    const user = userEvent.setup();

    render(<SettingsPage />);
    const input = await screen.findByLabelText(/ai confidence threshold/i);

    await user.clear(input);
    await user.type(input, "85");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith("fake-token", { aiConfidenceThreshold: 0.85 }),
    );
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("shows an error if saving fails", async () => {
    vi.mocked(updateSettings).mockRejectedValue(new Error("Request failed with status 500"));
    const user = userEvent.setup();

    render(<SettingsPage />);
    await screen.findByLabelText(/ai confidence threshold/i);
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/couldn.t save/i)).toBeInTheDocument();
  });
});
