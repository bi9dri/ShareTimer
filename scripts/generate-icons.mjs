// Renders the icons and the OGP card from public/logo.svg and
// public/wordmark.svg, so the raster assets stay derived from the source marks.
// The first run needs the browser: `pnpm exec playwright install chromium`.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicFile = (name) => join(ROOT, "public", name);

const INK = "#221F19";
const BG = "#F8F5F1";

function parseMark(source, name) {
  const viewBox = [...source.matchAll(/viewBox="([^"]+)"/g)].at(-1)?.[1];
  if (viewBox === undefined) throw new Error(`no viewBox in ${name}`);

  const paths = [...source.matchAll(/<path\b[^>]*\/>/g)]
    .map((match) => match[0].replace(/\sfill=(?:"[^"]*"|'[^']*')/g, ""))
    .join("");
  // An empty mark would silently overwrite every icon with a blank badge.
  if (paths === "") throw new Error(`no <path> in ${name}`);

  const [, , width, height] = viewBox.split(/[\s,]+/).map(Number);
  const aspect = width / height;
  if (!Number.isFinite(aspect)) throw new Error(`unparsable viewBox in ${name}`);
  return { viewBox, aspect, paths };
}

function svg({ mark, height, width }) {
  return `<svg viewBox="${mark.viewBox}" width="${width}" height="${height}"><g fill="${INK}">${mark.paths}</g></svg>`;
}

const logo = parseMark(await readFile(publicFile("logo.svg"), "utf8"), "logo.svg");
const wordmark = parseMark(await readFile(publicFile("wordmark.svg"), "utf8"), "wordmark.svg");

function badgeHtml(size, { radius, markRatio }) {
  const markHeight = size * markRatio;
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
    <div class="badge">${svg({ mark: logo, height: markHeight, width: markHeight * logo.aspect })}</div>
  </body></html>`;
}

function ogHtml() {
  const markHeight = 150;
  const wordWidth = 600;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; padding: 0; }
    .card {
      width: 1200px; height: 630px; background: ${BG};
      display: flex; align-items: center; justify-content: center; gap: 34px;
    }
    .card svg { display: block; }
  </style></head><body>
    <div class="card">
      ${svg({ mark: logo, height: markHeight, width: markHeight * logo.aspect })}
      ${svg({ mark: wordmark, height: wordWidth / wordmark.aspect, width: wordWidth })}
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

const rounded = { radius: 0.21, markRatio: 0.62, transparent: true };

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  async function shoot(html, { width, height, transparent }) {
    await page.setViewportSize({ width, height });
    await page.setContent(html, { waitUntil: "load" });
    return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } });
  }

  function renderBadge(size, options) {
    return shoot(badgeHtml(size, options), {
      width: size,
      height: size,
      transparent: options.transparent,
    });
  }

  // A small badge needs a relatively larger mark to stay legible.
  const faviconRatios = { 16: 0.68, 32: 0.66, 48: 0.64 };
  const favicon = {};
  for (const [size, markRatio] of Object.entries(faviconRatios)) {
    favicon[size] = await renderBadge(Number(size), { ...rounded, markRatio });
  }

  // 16 and 48 ship inside the ICO; only 32 is referenced from index.html.
  await writeFile(publicFile("favicon-32x32.png"), favicon[32]);
  await writeFile(
    publicFile("favicon.ico"),
    buildIco([16, 32, 48].map((size) => ({ size, data: favicon[size] }))),
  );

  await writeFile(publicFile("icon-192.png"), await renderBadge(192, { ...rounded, markRatio: 0.6 }));
  await writeFile(publicFile("icon-512.png"), await renderBadge(512, { ...rounded, markRatio: 0.6 }));

  // iOS fills transparent pixels with black.
  await writeFile(
    publicFile("apple-touch-icon.png"),
    await renderBadge(180, { radius: 0, markRatio: 0.58, transparent: false }),
  );
  // Platforms crop maskable icons, so the mark stays inside the safe circle.
  await writeFile(
    publicFile("icon-maskable-512.png"),
    await renderBadge(512, { radius: 0, markRatio: 0.46, transparent: false }),
  );

  await writeFile(
    publicFile("og-image.png"),
    await shoot(ogHtml(), { width: 1200, height: 630, transparent: false }),
  );
} finally {
  await browser.close();
}

const iconSize = 512;
const iconMarkHeight = iconSize * rounded.markRatio;
const iconMarkWidth = iconMarkHeight * logo.aspect;

await writeFile(
  publicFile("icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="108" fill="${BG}"/>
<svg x="${((iconSize - iconMarkWidth) / 2).toFixed(2)}" y="${((iconSize - iconMarkHeight) / 2).toFixed(2)}" width="${iconMarkWidth.toFixed(2)}" height="${iconMarkHeight.toFixed(2)}" viewBox="${logo.viewBox}"><g fill="${INK}">${logo.paths}</g></svg>
</svg>
`,
);
