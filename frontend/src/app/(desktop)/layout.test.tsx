import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DesktopLayout from "./layout";
import { useAuthSession } from "@/lib/auth-session";

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  usePathname: () => "/dashboard",
}));

function base64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe("DesktopLayout", () => {
  beforeEach(() => {
    pushMock.mockReset();
    replaceMock.mockReset();
    window.localStorage.clear();
    useAuthSession.setState({ token: null, claims: null, restored: false });
  });

  it("redirects to /login when there is no session", async () => {
    render(
      <DesktopLayout>
        <div>content</div>
      </DesktopLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("redirects a worker session to the mobile home instead of rendering", async () => {
    const token = makeJwt({ sub: "w1", tenantId: "t1", role: "worker", name: "Worker A" });
    useAuthSession.getState().login(token);

    render(
      <DesktopLayout>
        <div>content</div>
      </DesktopLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByText("content")).not.toBeInTheDocument();
  });

  it("renders the nav and children for a manager session", async () => {
    const token = makeJwt({ sub: "m1", tenantId: "t1", role: "manager", name: "Manager A" });
    useAuthSession.getState().login(token);

    render(
      <DesktopLayout>
        <div>content</div>
      </DesktopLayout>,
    );

    expect(await screen.findByText("content")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review queue/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inventory/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders for an owner session too", async () => {
    const token = makeJwt({ sub: "o1", tenantId: "t1", role: "owner", name: "Owner A" });
    useAuthSession.getState().login(token);

    render(
      <DesktopLayout>
        <div>content</div>
      </DesktopLayout>,
    );

    expect(await screen.findByText("content")).toBeInTheDocument();
  });
});
