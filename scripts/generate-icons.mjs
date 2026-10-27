// Renders every icon and the OGP card from public/logo.svg and
// public/wordmark.svg, so the raster assets never drift from the source marks.
//
//   pnpm icons
//
// Chromium comes from @playwright/test, which the E2E suite already depends on.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const INK = "#221F19";
const BG = "#F8F5F1";

function parseMark(source) {
  const viewBoxes = [...source.matchAll(/viewBox="([^"]+)"/g)];
  const last = viewBoxes.at(-1);
  if (last === undefined) throw new Error("viewBox not found");
  const paths = [...source.matchAll(/<path\b[^>]*\/>/g)]
    .map((match) => match[0].replace(/\sfill="#[0-9a-fA-F]+"/g, ""))
    .join("");
  return { viewBox: last[1], paths };
}

function svg({ mark, height, width }) {
  return `<svg viewBox="${mark.viewBox}" width="${width}" height="${height}"><g fill="${INK}">${mark.paths}</g></svg>`;
}

const logo = parseMark(await readFile("public/logo.svg", "utf8"));
const wordmark = parseMark(await readFile("public/wordmark.svg", "utf8"));

const logoAspect = 890.427 / 1024;
const wordmarkAspect = 2048 / 299;

function badgeHtml(size, { radius, markRatio }) {
  const markHeight = size * markRatio;
  const markWidth = markHeight * logoAspect;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    .badge {
      width: ${size}px; height: ${size}px;
      border-radius: ${Math.round(radius * size)}px;
      background: ${BG};
      display: grid; place-items: center;
    }
    .badge svg { display: block; }
  </style></head><body>
    <div class="badge">${svg({ mark: logo, height: markHeight, width: markWidth })}</div>
  </body></html>`;
}

function ogHtml() {
  const markHeight = 150;
  const markWidth = markHeight * logoAspect;
  const wordWidth = 600;
  const wordHeight = wordWidth / wordmarkAspect;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; }
    .card {
      width: 1200px; height: 630px; background: ${BG};
      display: flex; align-items: center; justify-content: center; gap: 34px;
    }
    .card svg { display: block; }
  </style></head><body>
    <div class="card">
      ${svg({ mark: logo, height: markHeight, width: markWidth })}
      ${svg({ mark: wordmark, height: wordHeight, width: wordWidth })}
    </div>
  </body></html>`;
}

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    entries.writeUInt8(size, at);
    entries.writeUInt8(size, at + 1);
    entries.writeUInt8(0, at + 2);
    entries.writeUInt8(0, at + 3);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, entries, ...images.map((image) => image.data)]);
}

const scratch = await mkdtemp(join(tmpdir(), "sharetimer-icons-"));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shoot(html, { width, height, path, transparent }) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path,
    omitBackground: transparent,
    clip: { x: 0, y: 0, width, height },
  });
}

/** Renders one badge and returns its PNG bytes. */
async function renderBadge(size, options) {
  const path = join(scratch, `badge-${size}.png`);
  await shoot(badgeHtml(size, options), {
    width: size,
    height: size,
    path,
    transparent: options.transparent,
  });
  return readFile(path);
}

const rounded = { radius: 0.21, markRatio: 0.62, transparent: true };
const faviconRatios = { 16: 0.68, 32: 0.66, 48: 0.64 };
const faviconPng = new Map();

for (const [size, markRatio] of Object.entries(faviconRatios)) {
  faviconPng.set(Number(size), await renderBadge(Number(size), { ...rounded, markRatio }));
}

// Only the sizes a browser picks from a <link> are separate files; the ICO
// bundles all three for the legacy path.
for (const size of [16, 32]) {
  await writeFile(`public/favicon-${size}x${size}.png`, faviconPng.get(size));
}

await writeFile(
  "public/favicon.ico",
  buildIco([16, 32, 48].map((size) => ({ size, data: faviconPng.get(size) }))),
);

await writeFile(
  "public/icon-192.png",
  await renderBadge(192, { ...rounded, markRatio: 0.6 }),
);
await writeFile(
  "public/icon-512.png",
  await renderBadge(512, { ...rounded, markRatio: 0.6 }),
);

// iOS fills transparent pixels with black, so these stay opaque edge to edge.
// A maskable icon gets cropped by the platform, so its mark sits inside the
// safe circle while the background covers the whole canvas.
await writeFile(
  "public/apple-touch-icon.png",
  await renderBadge(180, { radius: 0, markRatio: 0.58, transparent: false }),
);
await writeFile(
  "public/icon-maskable-512.png",
  await renderBadge(512, { radius: 0, markRatio: 0.46, transparent: false }),
);

await shoot(ogHtml(), {
  width: 1200,
  height: 630,
  path: "public/og-image.png",
  transparent: false,
});

await browser.close();
await rm(scratch, { recursive: true, force: true });

const markScale = 0.62;
await writeFile(
  "public/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="108" fill="${BG}"/>
<svg x="${(512 - 512 * markScale * logoAspect) / 2}" y="${(512 - 512 * markScale) / 2}" width="${512 * markScale * logoAspect}" height="${512 * markScale}" viewBox="${logo.viewBox}"><g fill="${INK}">${logo.paths}</g></svg>
</svg>
`,
);
