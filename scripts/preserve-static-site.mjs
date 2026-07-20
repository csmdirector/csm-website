import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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

async function copySanitizedHtml(file) {
  const source = path.join(root, file);
  const output = path.join(dist, file);
  const html = await readFile(source, 'utf8');

  await writeFile(output, sanitizeLegacyHtml(html), 'utf8');
}

await mkdir(dist, { recursive: true });

const entries = await readdir(root, { withFileTypes: true });
const htmlFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => entry.name);

for (const file of htmlFiles) {
  await copySanitizedHtml(file);
}

await cp(path.join(root, '_redirects'), path.join(dist, '_redirects'));
await cp(path.join(root, 'robots.txt'), path.join(dist, 'robots.txt'));
await cp(path.join(root, 'sitemap.xml'), path.join(dist, 'sitemap.xml'));
await cp(path.join(root, 'images'), path.join(dist, 'images'), {
  recursive: true,
  force: true
});

console.log(`Preserved ${htmlFiles.length} existing HTML pages, _redirects, robots.txt, sitemap.xml, and images/ in dist with legacy hardcoded GA4 removed from HTML output.`);
