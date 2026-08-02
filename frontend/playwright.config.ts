import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
  },
  webServer: {
    // Production build (next start), not next dev -- a frame-time budget
    // measured against Turbopack's dev-mode HMR/instrumentation overhead
    // isn't representative of what a yard manager's browser actually runs.
    // Requires `npm run build --workspace=frontend` to have been run first.
    // Its own port (3100), separate from the manual/dev-server 3000, so
    // this suite never collides with a locally running dev server or the
    // backend's 3001.
    command: "node ../node_modules/next/dist/bin/next start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
