import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = [
  ['piano-lessons.html', 'piano', '/book-piano-intro/'],
  ['voice-lessons.html', 'voice', '/book-intro/?service=voice'],
  ['guitar-lessons.html', 'guitar', '/book-intro/?service=guitar'],
  ['drum-lessons.html', 'drums', '/book-intro/?service=drums'],
  ['violin-lessons.html', 'violin', '/book-intro/?service=violin'],
  ['early-childhood-music-discovery-lessons.html', 'music-discovery', '/book-intro/?service=music-discovery']
];

for (const [file, slug, bookingUrl] of pages) {
  const html = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.match(html, /\/css\/service-request-info\.css/);
  assert.match(html, /\/js\/service-request-info\.js/);
  assert.match(html, new RegExp('data-service-slug="' + slug.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '"'));
  assert.match(html, /id="request-info"/);
  assert.match(html, new RegExp(bookingUrl.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html.match(/<section class="service-request-wrap"[\s\S]*?<\/section>/)?.[0] || '', /Middletown/i);
}

const js = readFileSync(new URL('../js/service-request-info.js', import.meta.url), 'utf8');
assert.match(js, /lesson-fit-submit/);
assert.match(js, /lesson_fit_help_submit/);
assert.match(js, /gclid/);
assert.match(js, /first_landing_path/);
assert.match(js, /latest_landing_path/);
assert.match(js, /existing_family/);
assert.doesNotMatch(js, /Middletown/i);

// Violin remains on its established URL; only the content and nav focus change.
const violinLanding = readFileSync(new URL('../violin-lessons.html', import.meta.url), 'utf8');
assert.match(violinLanding, /<title>Violin Lessons in Cincinnati/);
assert.match(violinLanding, /<h1>Violin Lessons <em>in Cincinnati<\/em><\/h1>/);
assert.match(violinLanding, /rel="canonical" href="https:\/\/cincinnatischoolofmusic.com\/violin-lessons"/);
assert.match(violinLanding, /Also interested in <em>Viola or Cello\?<\/em>/);
assert.match(violinLanding, /href="\/request-info\/\?intent=question"/);
assert.doesNotMatch(violinLanding, /<h1>Strings Lessons/);
for (const component of ['Nav', 'Footer']) {
  const markup = readFileSync(new URL('../src/components/' + component + '.astro', import.meta.url), 'utf8');
  assert.match(markup, /href="\/violin-lessons">Violin<\/a>/);
  assert.doesNotMatch(markup, /href="\/violin-lessons">Strings<\/a>/);
}
console.log('Known-intent service-page request forms verified.');

const lessonFitRouter = readFileSync(new URL('../src/pages/lesson-fit/index.astro', import.meta.url), 'utf8');
assert.ok(lessonFitRouter.includes("piano: '/piano-lessons/'"));
assert.ok(lessonFitRouter.includes("voice: '/voice-lessons/'"));
assert.ok(lessonFitRouter.includes("guitar: '/guitar-lessons/'"));
assert.ok(lessonFitRouter.includes("drums: '/drum-lessons/'"));
assert.ok(lessonFitRouter.includes("violin: '/violin-lessons/'"));
assert.ok(lessonFitRouter.includes("music_discovery: '/early-childhood-music-discovery-lessons/'"));
assert.ok(lessonFitRouter.includes("window.location.replace(destination + query + window.location.hash)"));
