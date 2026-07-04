import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const site = 'https://cincinnatischoolofmusic.com';

const routes = [
  '/',
  '/piano-lessons',
  '/voice-lessons',
  '/guitar-lessons',
  '/drum-lessons',
  '/violin-lessons',
  '/flute-clarinet-lessons',
  '/adult-lessons',
  '/early-childhood-music-discovery-lessons',
  '/gift-certificate',
  '/lessons',
  '/about-us',
  '/testimonials',
  '/recitals',
  '/cancel-lessons-form',
  '/holiday-schedule-closures',
  '/commonly-used-books',
  '/instrument-maintenance-request-form',
  '/olde-montgomery',
  '/mason',
  '/anderson',
  '/middletown',
  '/maineville',
  '/request-info',
  '/locations',
  '/teachers',
  '/parent-resources',
  '/parent-resources/music-lesson-cost-cincinnati',
  '/parent-resources/choosing-the-right-first-music-lesson',
  '/privacy-policy',
  '/sms-terms',
  '/withdraw'
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url>
    <loc>${site}${route === '/' ? '/' : route}</loc>
  </url>`).join('\n')}
</urlset>
`;

await writeFile(path.join(root, 'sitemap.xml'), xml, 'utf8');
console.log(`Generated sitemap.xml with ${routes.length} public indexable URLs.`);
