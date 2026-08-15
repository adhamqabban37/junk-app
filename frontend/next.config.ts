import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  /**
   * Lets a phone on the LAN actually load the app in dev.
   *
   * Next blocks cross-origin requests to dev-only resources (/_next/*,
   * webpack-hmr) from any origin other than the one the dev server was
   * started with -- localhost. Hitting the dev server from a phone at
   * http://192.168.1.26:3000 therefore serves the HTML but blocks every JS
   * chunk, and the page renders WHITE with no error on screen. The only
   * evidence is a warning in the dev server's own log:
   *
   *   Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr
   *
   * Dev-only: this option has no effect on `next build`/production, so it
   * cannot widen anything in a real deployment.
   *
   * NB the address is DHCP (Ethernet 7). If it changes, update this AND
   * frontend/.env.local, then restart -- NEXT_PUBLIC_* is inlined at
   * startup, not read per request.
   */
  allowedDevOrigins: ["192.168.1.26"],
};

export default nextConfig;
