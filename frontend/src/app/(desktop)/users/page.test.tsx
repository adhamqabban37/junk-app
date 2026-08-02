import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "./page";
import { useAuthSession } from "@/lib/auth-session";
import type { UserSummary } from "@/lib/api/users";

vi.mock("@/lib/api/users", () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));
import { listUsers, createUser, updateUser } from "@/lib/api/users";

function makeUser(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: "u1",
    tenantId: "t1",
    name: "Alex Worker",
    email: null,
    role: "worker",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("UsersPage", () => {
  beforeEach(() => {
    useAuthSession.setState({
      token: "fake-token",
      claims: { sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" },
      restored: true,
    });
    vi.mocked(listUsers).mockReset();
    vi.mocked(createUser).mockReset();
    vi.mocked(updateUser).mockReset();
  });

  it("shows a distinguishable error state, not the empty state, when users fail to load", async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error("Request failed with status 500"));
    render(<UsersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t load/i);
    expect(screen.queryByText(/no users yet/i)).not.toBeInTheDocument();
  });

  it("lists users with their role", async () => {
    vi.mocked(listUsers).mockResolvedValue([makeUser(), makeUser({ id: "u2", name: "Sam Manager", role: "manager", email: "sam@test.local" })]);
    render(<UsersPage />);

    await screen.findByText("Alex Worker");
    expect(screen.getByText("Sam Manager")).toBeInTheDocument();
  });

  it("creates a new worker with a PIN", async () => {
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(createUser).mockResolvedValue(makeUser({ id: "new-worker", name: "New Worker" }));
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText(/no users yet/i);

    await user.type(screen.getByLabelText(/^name$/i), "New Worker");
    await user.selectOptions(screen.getByLabelText(/^role$/i), "worker");
    await user.type(screen.getByLabelText(/pin/i), "1234");
    await user.click(screen.getByRole("button", { name: /add user/i }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        "fake-token",
        expect.objectContaining({ name: "New Worker", role: "worker", pin: "1234" }),
      ),
    );
  });

  it("creates a new manager with email and password", async () => {
    vi.mocked(listUsers).mockResolvedValue([]);
    vi.mocked(createUser).mockResolvedValue(makeUser({ id: "new-mgr", name: "New Manager", role: "manager" }));
    const user = userEvent.setup();

    render(<UsersPage />);
    await screen.findByText(/no users yet/i);

    await user.type(screen.getByLabelText(/^name$/i), "New Manager");
    await user.selectOptions(screen.getByLabelText(/^role$/i), "manager");
    await user.type(screen.getByLabelText(/^email$/i), "newmanager@test.local");
    await user.type(screen.getByLabelText(/^password$/i), "supersecret123");
    await user.click(screen.getByRole("button", { name: /add user/i }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(
        "fake-token",
        expect.objectContaining({
          name: "New Manager",
          role: "manager",
          email: "newmanager@test.local",
          password: "supersecret123",
        }),
      ),
    );
  });

  it("changes a user's role inline", async () => {
    vi.mocked(listUsers).mockResolvedValue([makeUser()]);
    vi.mocked(updateUser).mockResolvedValue(makeUser({ role: "manager" }));
    const user = userEvent.setup();

    render(<UsersPage />);
    const row = await screen.findByTestId("user-row-u1");

    await user.selectOptions(within(row).getByLabelText(/role/i), "manager");

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith("fake-token", "u1", { role: "manager" }),
    );
  });
});
