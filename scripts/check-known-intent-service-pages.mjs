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

console.log('Known-intent service-page request forms verified.');
