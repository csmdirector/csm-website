import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function assertSameFile(relativePath) {
  const source = path.join(root, relativePath);
  const output = path.join(dist, relativePath);

  if ((await digest(source)) !== (await digest(output))) {
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
  await assertSameFile(file);
}

await assertSameFile('_redirects');

const imageFiles = await listFiles(path.join(root, 'images'), 'images');
for (const file of imageFiles) {
  await assertSameFile(file);
}

console.log(`Verified preserved output: ${htmlFiles.length} HTML pages, _redirects, and ${imageFiles.length} image files match source.`);
