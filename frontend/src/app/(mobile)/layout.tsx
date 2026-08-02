"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SyncStatusBar } from "@/components/mobile/sync-status-bar";
import { apiBaseUrl } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { createFetchSyncClient, registerSyncTriggers } from "@/lib/offline/sync";
import { registerServiceWorker } from "@/lib/pwa";

const PUBLIC_PATHS = new Set(["/login"]);

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthSession((s) => s.token);
  const restored = useAuthSession((s) => s.restored);
  const restore = useAuthSession((s) => s.restore);

  useEffect(() => {
    restore();
  }, [restore]);

  // Unauthenticated too: the app shell (including /login) must still be
  // launchable offline once installed, before any session exists.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Registered once a session exists, unregistered on logout — the sync
  // client reads the token fresh on every call rather than closing over it,
  // so a token refresh mid-session doesn't require re-registering.
  useEffect(() => {
    if (!token) return;
    const client = createFetchSyncClient(apiBaseUrl(), () => useAuthSession.getState().token);
    return registerSyncTriggers(client);
  }, [token]);

  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (restored && !isPublic && !token) {
      router.replace("/login");
    }
  }, [restored, isPublic, token, router]);

  if (!isPublic && (!restored || !token)) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="flex flex-1 flex-col">{children}</main>
      {!isPublic && <SyncStatusBar />}
    </div>
  );
}
