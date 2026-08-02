// Modern Lighthouse (v10+, this repo uses v13) removed the scored "pwa"
// category entirely -- Google moved PWA/installability checks to Chrome
// DevTools' own Application panel, which has no scriptable Lighthouse
// output. `docs/PROGRESS.md`'s "Lighthouse PWA score" line item is
// therefore unproducable with current tooling, not a gap left open; the
// installability criteria that score used to represent (manifest, service
// worker, icons) are verified directly in
// frontend/e2e/pwa-installability.spec.ts instead. This script runs the
// categories Lighthouse still actually has.
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? "http://localhost:3100/login";
const chromePath = process.env.CHROME_PATH;

const chrome = await chromeLauncher.launch({
  chromeFlags: ["--headless=new", "--no-sandbox"],
  chromePath,
});

try {
  const runnerResult = await lighthouse(url, {
    port: chrome.port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  });

  if (!runnerResult) {
    throw new Error("Lighthouse produced no result");
  }

  const summary = Object.fromEntries(
    Object.entries(runnerResult.lhr.categories).map(([key, cat]) => [key, Math.round((cat.score ?? 0) * 100)]),
  );
  console.log(`Lighthouse scores for ${url}:`);
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.join(__dirname, "..", "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "lighthouse-report.json");
  fs.writeFileSync(reportPath, runnerResult.report);
  console.log(`Full report saved to ${reportPath}`);
} finally {
  await chrome.kill();
}
