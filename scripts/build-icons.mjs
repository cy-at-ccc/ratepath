/**
 * Generate apple-icon.png (180x180) and favicon.ico (multi-size)
 * from apps/web/app/icon.svg using sharp.
 *
 * Run: node scripts/build-icons.mjs
 */
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webAppDir = join(__dirname, "..", "apps", "web", "app");
const svgPath = join(webAppDir, "icon.svg");

const svgBuffer = await readFile(svgPath);

// Apple touch icon: 180x180 PNG (no transparency — alpha can cause iOS fringe)
await sharp(svgBuffer)
  .resize(180, 180, { fit: "contain", background: { r: 49, g: 46, b: 129, alpha: 1 } })
  .png()
  .toFile(join(webAppDir, "apple-icon.png"));

console.log("[ok] apps/web/app/apple-icon.png (180x180)");

// Modern favicon: 32x32 PNG (some older browsers only respect .ico; keep .ico too)
await sharp(svgBuffer)
  .resize(32, 32)
  .png()
  .toFile(join(webAppDir, "favicon-32.png"));

// Multi-size ICO for legacy browsers
const sizes = [16, 32, 48];
const icoBuffers = await Promise.all(
  sizes.map((size) =>
    sharp(svgBuffer).resize(size, size).png().toBuffer()
  )
);

// Compose a multi-image ICO (each entry: width=0 means 256, but we use 16/32/48)
/**
 * @param {Buffer[]} images
 */
function buildIco(images) {
  const count = images.length;
  // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes * count) + image data
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type 1 = icon
  header.writeUInt16LE(count, 4);      // count

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];

  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const img = images[i];
    const base = i * 16;
    entries.writeUInt8(size === 256 ? 0 : size, base + 0); // width (0 = 256)
    entries.writeUInt8(size === 256 ? 0 : size, base + 1); // height
    entries.writeUInt8(0, base + 2);                       // palette
    entries.writeUInt8(0, base + 3);                       // reserved
    entries.writeUInt16LE(1, base + 4);                    // color planes
    entries.writeUInt16LE(32, base + 6);                   // bits per pixel
    entries.writeUInt32LE(img.length, base + 8);           // image size
    entries.writeUInt32LE(offset, base + 12);              // image offset
    offset += img.length;
    blobs.push(img);
  }

  return Buffer.concat([header, entries, ...blobs]);
}

const ico = buildIco(icoBuffers);
await writeFile(join(webAppDir, "favicon.ico"), ico);

console.log(`[ok] apps/web/app/favicon.ico (multi-size ${sizes.join("/")}px)`);
console.log(`[ok] apps/web/app/favicon-32.png (32x32)`);
