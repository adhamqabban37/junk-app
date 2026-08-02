import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    // Vitest's 5s default is too tight for userEvent.type() on longer
    // strings (VINs, UUIDs) once jsdom environment setup itself is under
    // load -- these are real per-keystroke event simulations, not stuck
    // tests. 15s gives headroom without letting a genuinely hung test run
    // forever.
    testTimeout: 15000,
    // e2e/*.spec.ts use Playwright's own test()/test.describe(), which
    // crashes if Vitest tries to execute it under its own runner instead
    // (found via CI's first run: Vitest's default include glob matches
    // "*.spec.ts" anywhere, not just inside src/).
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
