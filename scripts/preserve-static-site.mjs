import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });

const entries = await readdir(root, { withFileTypes: true });
const htmlFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
  .map((entry) => entry.name);

for (const file of htmlFiles) {
  await cp(path.join(root, file), path.join(dist, file));
}

await cp(path.join(root, '_redirects'), path.join(dist, '_redirects'));
await cp(path.join(root, 'images'), path.join(dist, 'images'), {
  recursive: true,
  force: true
});

console.log(`Preserved ${htmlFiles.length} existing HTML pages, _redirects, and images/ in dist.`);
