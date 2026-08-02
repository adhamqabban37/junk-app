import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, "..", "public", "icons");
const svgPath = path.join(iconsDir, "icon.svg");

mkdirSync(iconsDir, { recursive: true });

const sizes = [192, 512];

for (const size of sizes) {
  await sharp(svgPath)
    .resize(size, size)
    .png()
    .toFile(path.join(iconsDir, `icon-${size}.png`));
}

// Maskable icon: same art, but with safe-area padding baked in (maskable
// icons get cropped to a circle/rounded-square by the OS, so content must
// stay within the inner ~80%).
const maskablePadding = 51; // ~10% of 512
await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: "#111827",
  },
})
  .composite([
    {
      input: await sharp(svgPath).resize(512 - maskablePadding * 2, 512 - maskablePadding * 2).png().toBuffer(),
      top: maskablePadding,
      left: maskablePadding,
    },
  ])
  .png()
  .toFile(path.join(iconsDir, "icon-maskable-512.png"));

console.log("Generated icons in", iconsDir);
