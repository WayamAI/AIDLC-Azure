/**
 * Removes near-white paper background from AIDLC logo PNG.
 * Run: node scripts/process-logo.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const src = join(publicDir, "aidlc-logo-source.png");

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

for (let i = 0; i < data.length; i += channels) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  if (lum > 210 && sat < 50) {
    data[i + 3] = 0;
  }
}

const processed = await sharp(data, { raw: { width, height, channels } })
  .png()
  .toBuffer();

const meta = await sharp(processed).metadata();
const trimmed = await sharp(processed).trim().png().toBuffer();
const trimMeta = await sharp(trimmed).metadata();

await sharp(trimmed).png({ compressionLevel: 9 }).toFile(join(publicDir, "logo.png"));

const iconWidth = Math.round(trimMeta.width * 0.36);
const icon = await sharp(trimmed)
  .extract({ left: 0, top: 0, width: iconWidth, height: trimMeta.height })
  .extend({
    top: 0,
    bottom: 0,
    left: Math.max(0, Math.floor((trimMeta.height - iconWidth) / 2)),
    right: Math.max(0, Math.ceil((trimMeta.height - iconWidth) / 2)),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(join(publicDir, "logo-icon.png"));

await sharp(join(publicDir, "logo-icon.png"))
  .resize(32, 32)
  .png()
  .toFile(join(publicDir, "favicon.png"));

console.log("logo.png", trimMeta.width, "x", trimMeta.height);
console.log("logo-icon.png + favicon.png written");
