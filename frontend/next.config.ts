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
   * Every address this machine can be reached on has to be listed, because
   * the block is keyed on the origin the BROWSER used, not on what the dev
   * server bound to. It binds :: (all interfaces), so all of these already
   * serve HTTP 200 -- being reachable is not the same as being allowed, and
   * the difference between the two is a blank screen.
   *
   * The "Network:" address Next prints at startup is NOT authoritative; it
   * picks one interface arbitrarily and has been observed printing the VPN
   * and Tailscale addresses on consecutive starts. Ignore it.
   *
   * NB the 192.168.1.x addresses are DHCP. If one changes, update this AND
   * frontend/.env.local, then restart -- NEXT_PUBLIC_* is inlined at
   * startup, not read per request.
   */
  allowedDevOrigins: [
    "192.168.1.26", // Ethernet 7 (DHCP) -- the phone-on-LAN address
    "192.168.1.193", // Wi-Fi (DHCP) -- same subnet, so the phone may land here instead
    "10.5.0.2", // NordLynx VPN -- laptop-only; a phone is not on the VPN
  ],
};

export default nextConfig;
