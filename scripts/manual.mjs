import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { chromium } from "playwright-core";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const manuals = join(root, "docs", "manual");

const FONTS = [
  ["IBM Plex Sans", "ibm-plex-sans", 400, "normal"],
  ["IBM Plex Sans", "ibm-plex-sans", 400, "italic"],
  ["IBM Plex Sans", "ibm-plex-sans", 600, "normal"],
  ["IBM Plex Sans", "ibm-plex-sans", 700, "normal"],
  ["IBM Plex Mono", "ibm-plex-mono", 400, "normal"],
  ["IBM Plex Mono", "ibm-plex-mono", 600, "normal"],
];

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

function languages() {
  const wanted = process.argv.slice(2);
  if (wanted.length > 0) return wanted;
  return readdirSync(manuals, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(manuals, entry.name, "manual.md")))
    .map((entry) => entry.name);
}

function ensureBrowser() {
  const cli = join(dirname(require.resolve("playwright-core/package.json")), "cli.js");
  execFileSync(process.execPath, [cli, "install", "--only-shell", "--no-remove", "chromium"], {
    stdio: "inherit",
  });
}

function splitFrontMatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error("manual.md must start with a YAML front matter block");
  return { meta: parse(match[1]), body: source.slice(match[0].length) };
}

function dataUri(path) {
  const type = MIME[extname(path)] ?? "font/woff2";
  return `data:${type};base64,${readFileSync(path).toString("base64")}`;
}

function fontFaces() {
  return FONTS.map(([family, pkg, weight, style]) => {
    const file = require.resolve(`@fontsource/${pkg}/files/${pkg}-latin-${weight}-${style}.woff2`);
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};src:url(${dataUri(file)}) format("woff2");}`;
  }).join("\n");
}

function renderer(dir) {
  return new Marked({
    gfm: true,
    renderer: {
      image({ href, title, text }) {
        const caption = title ? `<figcaption>${title}</figcaption>` : "";
        return `<figure><img src="${dataUri(join(dir, href))}" alt="${text}">${caption}</figure>`;
      },
      paragraph({ tokens }) {
        const inline = this.parser.parseInline(tokens);
        return tokens.length === 1 && tokens[0].type === "image" ? inline : `<p>${inline}</p>\n`;
      },
    },
  });
}

function cover(meta) {
  return `<section class="cover">
  <div class="cover-product">${meta.product}</div>
  <h1 class="cover-title">${meta.title}</h1>
  <p class="cover-subtitle">${meta.subtitle}</p>
  <dl class="cover-facts">
    <dt>${meta.labels.version}</dt><dd>${meta.package} ${meta.version}</dd>
    <dt>${meta.labels.date}</dt><dd>${meta.dateText}</dd>
    <dt>${meta.labels.audience}</dt><dd>${meta.audience}</dd>
  </dl>
</section>`;
}

function page(meta, content) {
  const css = readFileSync(join(manuals, "manual.css"), "utf8");
  const footer = `${meta.product} ${meta.version} · ${meta.title}`;
  return `<!doctype html>
<html lang="${meta.lang}">
<head>
<meta charset="utf-8">
<title>${footer}</title>
<style>${fontFaces()}
${css}
@page { @bottom-left { content: "${footer}"; } @bottom-right { content: counter(page) " / " counter(pages); } }
</style>
</head>
<body>
${cover(meta)}
<main>${content}</main>
</body>
</html>`;
}

function pdfDate(date) {
  return `D:${String(date).replaceAll("-", "")}120000+00'00'`;
}

function pinDates(pdf, date) {
  const text = pdf.toString("latin1");
  const pinned = text.replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, `/$1 (${pdfDate(date)})`);
  return Buffer.from(pinned, "latin1");
}

function pageCount(pdf) {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

async function build(browser, lang) {
  const dir = join(manuals, lang);
  const { meta, body } = splitFrontMatter(readFileSync(join(dir, "manual.md"), "utf8"));
  const html = page(meta, renderer(dir).parse(body));
  const tab = await browser.newPage();
  await tab.setContent(html, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const pdf = pinDates(
    await tab.pdf({ preferCSSPageSize: true, printBackground: true }),
    meta.date,
  );
  await tab.close();
  const pages = pageCount(pdf);
  const out = join(manuals, `bae-manual-${lang}.pdf`);
  writeFileSync(out, pdf);
  console.log(`${out}: ${pages} page(s)`);
  if (meta.maxPages && pages > meta.maxPages) {
    throw new Error(`${lang}: ${pages} pages, more than maxPages (${meta.maxPages})`);
  }
}

async function main() {
  ensureBrowser();
  const browser = await chromium.launch();
  try {
    for (const lang of languages()) await build(browser, lang);
  } finally {
    await browser.close();
  }
}

await main();
