import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", () => ({
  listWorkers: vi.fn(),
  loginPin: vi.fn(),
  loginManager: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { listWorkers, loginManager, loginPin } from "@/lib/api";
import { clearTenantId, getTenantId, setTenantId } from "@/lib/tenant";
import { useTenantStore } from "@/lib/tenant-store";
import { useAuthSession } from "@/lib/auth-session";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("LoginPage", () => {
  beforeEach(() => {
    clearTenantId();
    window.localStorage.clear();
    useAuthSession.setState({ token: null, claims: null, restored: false });
    useTenantStore.setState({ tenantId: null, hydrated: false });
    pushMock.mockReset();
    vi.mocked(listWorkers).mockReset();
    vi.mocked(loginPin).mockReset();
    vi.mocked(loginManager).mockReset();
  });

  afterEach(() => {
    clearTenantId();
  });

  it("shows a device setup form when no tenant is bound yet, and binds it on submit", async () => {
    const user = userEvent.setup();
    vi.mocked(listWorkers).mockResolvedValue([]);
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: /set up this device/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/yard\/tenant id/i), TENANT_ID);
    await user.click(screen.getByRole("button", { name: /bind this device/i }));

    await waitFor(() => expect(getTenantId()).toBe(TENANT_ID));
  });

  it("shows an empty state when the tenant has no workers configured yet", async () => {
    setTenantId(TENANT_ID);
    vi.mocked(listWorkers).mockResolvedValue([]);

    render(<LoginPage />);

    await waitFor(() => expect(vi.mocked(listWorkers)).toHaveBeenCalledWith(TENANT_ID));
    expect(await screen.findByText(/no workers/i)).toBeInTheDocument();
  });

  it("worker PIN login: selecting a worker, entering the correct PIN logs in and redirects home", async () => {
    setTenantId(TENANT_ID);
    vi.mocked(listWorkers).mockResolvedValue([{ id: "worker-1", name: "Worker A" }]);
    const workerToken = makeJwt({ sub: "worker-1", tenantId: TENANT_ID, role: "worker", name: "Worker A" });
    vi.mocked(loginPin).mockResolvedValue(workerToken);
    const user = userEvent.setup();

    render(<LoginPage />);

    const workerButton = await screen.findByRole("button", { name: "Worker A" });
    await user.click(workerButton);

    await user.type(screen.getByLabelText(/pin/i), "4321");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(useAuthSession.getState().token).toBe(workerToken);
  });

  it("worker PIN login: shows an inline error on the wrong PIN without navigating away", async () => {
    setTenantId(TENANT_ID);
    vi.mocked(listWorkers).mockResolvedValue([{ id: "worker-1", name: "Worker A" }]);
    const { ApiError } = await import("@/lib/api");
    vi.mocked(loginPin).mockRejectedValue(new ApiError("Invalid worker or PIN", 401));
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.click(await screen.findByRole("button", { name: "Worker A" }));
    await user.type(screen.getByLabelText(/pin/i), "0000");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid worker or pin/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("manager login: switching tabs and submitting valid credentials logs in and redirects", async () => {
    setTenantId(TENANT_ID);
    vi.mocked(listWorkers).mockResolvedValue([]);
    const managerToken = makeJwt({
      sub: "manager-1",
      tenantId: TENANT_ID,
      role: "manager",
      name: "Manager A",
    });
    vi.mocked(loginManager).mockResolvedValue(managerToken);
    const user = userEvent.setup();

    render(<LoginPage />);
    await screen.findByText(/no workers/i);

    await user.click(screen.getByRole("tab", { name: /manager/i }));
    await user.type(screen.getByLabelText(/email/i), "manager@yard.local");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
    expect(useAuthSession.getState().token).toBe(managerToken);
  });

  it("manager login: shows an inline error on invalid credentials", async () => {
    setTenantId(TENANT_ID);
    vi.mocked(listWorkers).mockResolvedValue([]);
    const { ApiError } = await import("@/lib/api");
    vi.mocked(loginManager).mockRejectedValue(new ApiError("Invalid email or password", 401));
    const user = userEvent.setup();

    render(<LoginPage />);
    await screen.findByText(/no workers/i);

    await user.click(screen.getByRole("tab", { name: /manager/i }));
    await user.type(screen.getByLabelText(/email/i), "manager@yard.local");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^log in$/i }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/invalid email or password/i)).toBeInTheDocument();
  });
});
