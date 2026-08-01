"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SyncStatusBar } from "@/components/mobile/sync-status-bar";
import { useAuthSession } from "@/lib/auth-session";

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
