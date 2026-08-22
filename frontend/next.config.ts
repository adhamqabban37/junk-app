import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // Lets phones/other LAN devices load JS/HMR assets when hitting the dev
  // server via this machine's LAN IP instead of localhost -- Next.js blocks
  // cross-origin dev-resource requests by default.
  allowedDevOrigins: ["192.168.1.181"],
};

export default nextConfig;
