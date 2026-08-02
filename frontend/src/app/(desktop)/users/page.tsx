"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/lib/auth-session";
import { listUsers, createUser, updateUser, type UserSummary } from "@/lib/api/users";

type NewUserRole = "worker" | "manager";

export default function UsersPage() {
  const token = useAuthSession((s) => s.token);
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState<NewUserRole>("worker");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    listUsers(token)
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [token]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createUser(
        token,
        role === "worker" ? { name, role, pin } : { name, role, email, password },
      );
      setUsers((prev) => (prev ? [...prev, created] : [created]));
      setName("");
      setPin("");
      setEmail("");
      setPassword("");
    } catch {
      setError("Couldn't create that user. Check the fields and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: "worker" | "manager") {
    if (!token) return;
    const previous = users;
    setUsers((prev) => (prev ? prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)) : prev));
    try {
      await updateUser(token, userId, { role: newRole });
    } catch {
      setUsers(previous);
      setError("Couldn't update that user's role.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Users</h1>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="new-user-name" className="text-xs font-medium text-muted-foreground">
            Name
          </label>
          <input
            id="new-user-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-user-role" className="text-xs font-medium text-muted-foreground">
            Role
          </label>
          <select
            id="new-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as NewUserRole)}
            className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        {role === "worker" ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="new-user-pin" className="text-xs font-medium text-muted-foreground">
              PIN
            </label>
            <input
              id="new-user-pin"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
              minLength={4}
              maxLength={8}
              className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-user-email" className="text-xs font-medium text-muted-foreground">
                Email
              </label>
              <input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="new-user-password" className="text-xs font-medium text-muted-foreground">
                Password
              </label>
              <input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
          </>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Adding…" : "Add user"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {users === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users yet — add a worker or manager above.</p>
      ) : (
        <div className="grid gap-2">
          {users.map((u) => (
            <div
              key={u.id}
              data-testid={`user-row-${u.id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-border p-3"
            >
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-sm text-muted-foreground">{u.email ?? "PIN login"}</p>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`role-${u.id}`} className="text-xs font-medium text-muted-foreground">
                  Role
                </label>
                <select
                  id={`role-${u.id}`}
                  value={u.role === "owner" ? "manager" : u.role}
                  disabled={u.role === "owner"}
                  onChange={(e) => handleRoleChange(u.id, e.target.value as "worker" | "manager")}
                  className="rounded-lg border border-input bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="worker">Worker</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
