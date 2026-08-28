import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NEW_STUDENT_OFFER } from '../shared/new-student-offer.js';

const root = new URL('../', import.meta.url).pathname;
const scanDist = process.argv.includes('--dist');
const scanRoot = scanDist ? join(root, 'dist') : root;
const extensions = scanDist ? new Set(['.html']) : new Set(['.html', '.astro', '.md']);
const excludedRoots = new Set(['.git', 'dist', 'node_modules', 'docs']);
const excludedPublicFiles = new Set([
  'src/pages/book-piano-intro/csm-payment-experiment.astro',
  'src/pages/book-piano-intro/csm-payment-success.astro'
]);

function extension(file) {
  const dot = file.lastIndexOf('.');
  return dot === -1 ? '' : file.slice(dot);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (!scanDist && excludedRoots.has(name)) return [];
    const absolute = join(directory, name);
    const file = relative(scanRoot, absolute).replaceAll('\\', '/');
    if (statSync(absolute).isDirectory()) return walk(absolute);
    if (!extensions.has(extension(name))) return [];
    if (!scanDist && extension(name) === '.md' && !file.startsWith('src/content/')) return [];
    if (!scanDist && file.includes('/') && !file.startsWith('src/')) return [];
    if (!scanDist && excludedPublicFiles.has(file)) return [];
    if (scanDist && file.startsWith('book-piano-intro/csm-payment-')) return [];
    return [{ file, content: readFileSync(absolute, 'utf8') }];
  });
}

const files = walk(scanRoot);
const failures = [];
const stalePatterns = [
  [/\bintro lesson\b/, 'Capitalize the approved “Intro Lesson” term consistently.'],
  [/\btrial lesson\b/i, 'Use “Intro Lesson,” never “trial lesson.”'],
  [/\bfree trial\b/i, 'Use “Free Intro Lesson,” never “free trial.”'],
  [/Start with a \$42 Intro Lesson/i, 'Paid Intro Lesson copy remains.'],
  [/Your intro lesson is \$42/i, 'Paid Piano Intro copy remains.'],
  [/private piano (?:Intro )?Lesson for \$42/i, 'Paid Piano Intro copy remains.'],
  [/\bFree Registration\b/i, 'Automatic registration waiver language remains.'],
  [/registration fee (?:is )?waived/i, 'Automatic registration waiver language remains.'],
  [/\$50 Off (?:Your )?First Full Month/i, 'Superseded first-month promotion remains.'],
  [/\$142(?:\s+Off|\s+offer| when)/i, 'Superseded $142 promotion remains.']
];

for (const { file, content } of files) {
  for (const [pattern, message] of stalePatterns) {
    if (pattern.test(content)) failures.push(`${file}: ${message}`);
  }
}

const required = scanDist
  ? [
      'index.html',
      'lessons.html',
      'lesson-fit/index.html',
      'book-piano-intro/index.html',
      'book-piano-intro/thank-you/index.html',
      'parent-resources/music-lesson-cost-cincinnati/index.html',
      'promos/index.html',
      'back-to-school/index.html'
    ]
  : [
      'index.html',
      'lessons.html',
      'src/pages/lesson-fit/index.astro',
      'src/pages/book-piano-intro/index.astro',
      'src/pages/book-piano-intro/thank-you.astro',
      'src/content/parent-resources/music-lesson-cost-cincinnati.md',
      'src/pages/promos/index.astro',
      'src/pages/back-to-school/index.astro'
    ];

const requiredPhrases = [
  NEW_STUDENT_OFFER.introName,
  '5% off',
  NEW_STUDENT_OFFER.welcomeThirtyMinuteRate,
  NEW_STUDENT_OFFER.standardThirtyMinuteRate,
  NEW_STUDENT_OFFER.registrationFee
];

for (const file of required) {
  const entry = files.find((candidate) => candidate.file === file);
  if (!entry) {
    failures.push(`${file}: required offer surface was not found.`);
    continue;
  }
  if (!scanDist && file.endsWith('.astro')) {
    if (!entry.content.includes('NEW_STUDENT_OFFER')) {
      failures.push(`${file}: does not consume the centralized offer values.`);
    }
    if (!entry.content.includes(NEW_STUDENT_OFFER.introName)) {
      failures.push(`${file}: missing visible “${NEW_STUDENT_OFFER.introName}” copy.`);
    }
    continue;
  }
  for (const phrase of requiredPhrases) {
    if (!entry.content.includes(phrase)) failures.push(`${file}: missing canonical offer value “${phrase}”.`);
  }
}

if (!scanDist) {
  const trackingSource = readFileSync(join(root, 'src/components/TrackingHead.astro'), 'utf8');
  const trackingRequirements = [
    "['gclid','gbraid','wbraid','utm_source','utm_medium','utm_campaign','utm_term','utm_content']",
    'first_landing_path',
    'latest_landing_path',
    'landing_path',
    'attribution_timestamp',
    'function decorateUrl(url)',
    'link.href = decoratedHref',
    "event: 'book_intro_click'"
  ];
  for (const requirement of trackingRequirements) {
    if (!trackingSource.includes(requirement)) {
      failures.push(`src/components/TrackingHead.astro: missing preserved attribution behavior “${requirement}”.`);
    }
  }
}

if (scanDist) {
  const directIntroLinks = [];
  const renderedIntroRoutes = new Set();
  const introLinkPattern = /<a\b[^>]*href=["'](https:\/\/cincinnatischoolofmusic\.opus1\.io\/w\/[^"']*intro[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const introRoutePattern = /https:\/\/cincinnatischoolofmusic\.opus1\.io\/w\/[A-Za-z0-9_-]*intro[A-Za-z0-9_-]*/g;
  for (const { file, content } of files) {
    for (const route of content.match(introRoutePattern) || []) {
      renderedIntroRoutes.add(new URL(route).pathname);
    }
    let match;
    while ((match = introLinkPattern.exec(content))) {
      directIntroLinks.push({
        file,
        url: match[1].replaceAll('&amp;', '&'),
        label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      });
    }
  }
  if (renderedIntroRoutes.size < 23) {
    failures.push(`Rendered site retains only ${renderedIntroRoutes.size} distinct Intro booking routes; expected at least 23.`);
  }
  for (const { file, label } of directIntroLinks) {
    if (label !== 'Book a Free Intro Lesson') {
      failures.push(`${file}: direct Intro booking CTA label is “${label}”, not “Book a Free Intro Lesson”.`);
    }
  }
}

if (failures.length) {
  console.error(`New-student offer consistency failed (${scanDist ? 'dist' : 'source'}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`New-student offer consistency passed (${scanDist ? 'dist' : 'source'}): ${files.length} public files checked.`);
