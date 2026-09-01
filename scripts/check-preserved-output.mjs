import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const trackingHeadHtml = (await readFile(path.join(root, 'src/components/TrackingHead.astro'), 'utf8'))
  .replaceAll(' is:inline', '');
const hardcodedGa4Pattern = /\n?<!-- Google Analytics 4 -->\n<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-R3FZGNMFEK"><\/script>\n<script>\n\s*window\.dataLayer = window\.dataLayer \|\| \[\];\n\s*function gtag\(\)\{dataLayer\.push\(arguments\);\}\n\s*gtag\('js', new Date\(\)\);\n\s*gtag\('config', 'G-R3FZGNMFEK'\);\n<\/script>\n<!-- End Google Analytics 4 -->\n?/g;
const directGtagEventPattern = /\n\s*if\(typeof gtag === 'function'\)\{\n\s*gtag\('event', 'book_intro_click', \{\n\s*link_url: link\.href,\n\s*page_path: location,\n\s*link_text: \(link\.textContent \|\| ''\)\.trim\(\)\.slice\(0, 80\)\n\s*\}\);\n\s*\}/g;
const trackingBlockPattern = /\n?<!-- CSM-TRACKING-INJECTED v\d+ -->[\s\S]*?<!-- End Book Intro click tracking -->\n?/;

function sanitizeLegacyHtml(html) {
  return html
    .replace(trackingBlockPattern, `\n${trackingHeadHtml}\n`)
    .replace(hardcodedGa4Pattern, '\n')
    .replace(directGtagEventPattern, '');
}

async function assertSameFile(relativePath, transform = (content) => content) {
  const source = path.join(root, relativePath);
  const output = path.join(dist, relativePath);
  const sourceContent = transform(await readFile(source, 'utf8'));
  const outputContent = await readFile(output, 'utf8');

  if (createHash('sha256').update(sourceContent).digest('hex') !== createHash('sha256').update(outputContent).digest('hex')) {
    throw new Error(`${relativePath} changed during build output preservation.`);
  }
}

async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

await stat(dist);

const rootEntries = await readdir(root, { withFileTypes: true });
const htmlFiles = rootEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => entry.name);

for (const file of htmlFiles) {
  await assertSameFile(file, sanitizeLegacyHtml);
}

await assertSameFile('_redirects');
await assertSameFile('robots.txt');
await assertSameFile('sitemap.xml');

const resourceOutputRoot = path.join(dist, 'parent-resources');
const resourceHtmlFiles = (await listFiles(resourceOutputRoot))
  .filter((file) => file.endsWith('index.html'));

for (const file of resourceHtmlFiles) {
  const route = file === 'index.html'
    ? '/parent-resources/'
    : `/parent-resources/${path.dirname(file)}/`;
  const expectedCanonical = `https://cincinnatischoolofmusic.com${route}`;
  const html = await readFile(path.join(resourceOutputRoot, file), 'utf8');

  if (!html.includes(`<link rel="canonical" href="${expectedCanonical}">`)) {
    throw new Error(`${route} does not declare its direct, trailing-slash URL as canonical.`);
  }
}

const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
const redirectingResourceUrls = [...sitemap.matchAll(/<loc>(https:\/\/cincinnatischoolofmusic\.com\/parent-resources[^<]*)<\/loc>/g)]
  .map((match) => match[1])
  .filter((url) => !url.endsWith('/'));

if (redirectingResourceUrls.length > 0) {
  throw new Error(`Resource sitemap URLs must resolve directly instead of redirecting: ${redirectingResourceUrls.join(', ')}`);
}

const imageFiles = await listFiles(path.join(root, 'images'), 'images');
for (const file of imageFiles) {
  await assertSameFile(file);
}

console.log(`Verified preserved output: ${htmlFiles.length} HTML pages, _redirects, robots.txt, sitemap.xml, and ${imageFiles.length} image files match source.`);
