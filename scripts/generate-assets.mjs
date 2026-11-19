import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicFile = (name) => join(ROOT, "public", name);
const rootFile = (name) => join(ROOT, name);

function oklchToHex(color) {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(color);
  if (match === null) throw new Error(`unsupported oklch(): ${color}`);

  const [lightness, chroma, hue] = match.slice(1).map(Number);
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const hex = channels
    .map((channel) => {
      const srgb = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, srgb)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");
  return `#${hex.toUpperCase()}`;
}

function toHex(value) {
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (color.startsWith("oklch(")) return oklchToHex(color);
  throw new Error(`unsupported colour: ${color}`);
}

const style = await readFile(rootFile("src/frontend/style.css"), "utf8");

function cssColor(variable) {
  const match = new RegExp(`${variable}:\\s*([^;]+);`).exec(style);
  if (match === null) throw new Error(`missing ${variable} in style.css`);
  return toHex(match[1]);
}

const BG = cssColor("--bg");
const INK = cssColor("--fg-strong");

async function setColor(file, pattern, value) {
  const path = rootFile(file);
  const source = await readFile(path, "utf8");
  if (source.match(pattern) === null) throw new Error(`${file}: no match for ${pattern}`);

  const next = source.replace(pattern, (_, before, after) => `${before}${value}${after}`);
  if (next !== source) await writeFile(path, next);
}

function parseMark(source, name) {
  const viewBox = [...source.matchAll(/viewBox="([^"]+)"/g)].at(-1)?.[1];
  if (viewBox === undefined) throw new Error(`no viewBox in ${name}`);

  const paths = [...source.matchAll(/<path\b[^>]*\/>/g)]
    .map((match) => match[0].replace(/\sfill=(?:"[^"]*"|'[^']*')/g, ""))
    .join("");
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

await setColor("index.html", /(<meta name="theme-color" content=")[^"]*(")/, BG);
await setColor(
  "public/site.webmanifest",
  /("(?:background_color|theme_color)": ")[^"]*(")/g,
  BG,
);

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

  const faviconRatios = { 16: 0.68, 32: 0.66, 48: 0.64 };
  const favicon = {};
  for (const [size, markRatio] of Object.entries(faviconRatios)) {
    favicon[size] = await renderBadge(Number(size), { ...rounded, markRatio });
  }

  await writeFile(publicFile("favicon-32x32.png"), favicon[32]);
  await writeFile(
    publicFile("favicon.ico"),
    buildIco([16, 32, 48].map((size) => ({ size, data: favicon[size] }))),
  );

  await writeFile(publicFile("icon-192.png"), await renderBadge(192, { ...rounded, markRatio: 0.6 }));
  await writeFile(publicFile("icon-512.png"), await renderBadge(512, { ...rounded, markRatio: 0.6 }));

  await writeFile(
    publicFile("apple-touch-icon.png"),
    await renderBadge(180, { radius: 0, markRatio: 0.58, transparent: false }),
  );
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
