"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DesktopNav } from "@/components/desktop/desktop-nav";
import { useAuthSession } from "@/lib/auth-session";

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAuthSession((s) => s.token);
  const claims = useAuthSession((s) => s.claims);
  const restored = useAuthSession((s) => s.restored);
  const restore = useAuthSession((s) => s.restore);

  useEffect(() => {
    restore();
  }, [restore]);

  const isManagerOrOwner = claims?.role === "manager" || claims?.role === "owner";

  useEffect(() => {
    if (!restored) return;
    if (!token) {
      router.replace("/login");
      return;
    }
    if (!isManagerOrOwner) {
      // A worker session landing here (e.g. a stale bookmark) belongs on
      // the mobile home, not this dashboard -- the backend's own RBAC
      // guards are the real security boundary either way.
      router.replace("/");
    }
  }, [restored, token, isManagerOrOwner, router]);

  if (!restored || !token || !isManagerOrOwner) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1">
      <DesktopNav />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
