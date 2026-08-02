import { authFetch } from "../api";

export type UserRole = "worker" | "manager" | "owner";

export interface UserSummary {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  role: UserRole;
  createdAt: string;
}

export interface CreateUserInput {
  name: string;
  role: "worker" | "manager";
  email?: string;
  password?: string;
  pin?: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: "worker" | "manager";
}

export function listUsers(token: string, fetchImpl?: typeof fetch): Promise<UserSummary[]> {
  return authFetch<UserSummary[]>("/users", { token }, fetchImpl);
}

export function createUser(
  token: string,
  input: CreateUserInput,
  fetchImpl?: typeof fetch,
): Promise<UserSummary> {
  return authFetch<UserSummary>(
    "/users",
    { token, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    fetchImpl,
  );
}

export function updateUser(
  token: string,
  id: string,
  input: UpdateUserInput,
  fetchImpl?: typeof fetch,
): Promise<UserSummary> {
  return authFetch<UserSummary>(
    `/users/${id}`,
    { token, method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    fetchImpl,
  );
}
