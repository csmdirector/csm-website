import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseAttribution, attributionSourceLabel, attributionSummary } from '../netlify/functions/_shared/piano-preregistration.js';
import { INTRO_SERVICES, INTRO_LOCATIONS, introBookingUrl } from '../shared/intro-bridge-config.js';

const source = readFileSync(new URL('../src/components/TrackingHead.astro', import.meta.url), 'utf8').match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const site = 'https://cincinnatischoolofmusic.com';
const opus = 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason';
const day = 86400000;
const start = Date.parse('2026-06-01T10:00:00Z');
const makeStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
function browser({ blocked = '', initial = {} } = {}) {
  const localStorage = makeStorage(), sessionStorage = makeStorage();
  Object.entries(initial).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  if (blocked === 'writes') {
    for (const storage of [localStorage, sessionStorage]) storage.setItem = () => { throw new Error('QuotaExceededError'); };
  }
  return function visit(path, age = 0, referrer = '') {
    let now = start + age * day;
    class Clock extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    }
    const window = { location: new URL(path, site), dataLayer: [] };
    for (const [name, storage] of Object.entries({ localStorage, sessionStorage })) {
      Object.defineProperty(window, name, { get() { if (blocked === 'access') throw new Error('SecurityError'); return storage; } });
    }
    vm.runInNewContext(source, { window, document: { referrer }, Date: Clock, URL, URLSearchParams });
    return { api: window.CSMAttribution, events: window.dataLayer, advance: days => { now += days * day; } };
  };
}

// A later email is the latest source; the paid click survives independently.
{
  const visit = browser();
  visit('/');
  const paid = visit('/piano-lessons/?gclid=TEST-PAID&utm_source=google&utm_medium=cpc&utm_campaign=piano', 1, 'https://google.com/');
  const paidTime = paid.api.getLatest().last_paid_click_timestamp;
  const email = visit('/?utm_source=newsletter&utm_medium=email&utm_campaign=june', 2, 'https://mail.example.com/');
  const latest = email.api.getLatest();
  assert.equal(latest.utm_source, 'newsletter');
  assert.equal(latest.gclid, '');
  assert.equal(latest.last_paid_gclid, 'TEST-PAID');
  assert.equal(latest.last_paid_utm_campaign, 'piano');
  assert.equal(latest.last_paid_click_timestamp, paidTime);
  assert.equal(email.api.getStore().first_touch.source_type, 'direct');
  const forwarded = new URL(email.api.decorateUrl(opus));
  assert.equal(forwarded.searchParams.get('utm_source'), 'newsletter');
  assert.equal(forwarded.searchParams.get('gclid'), null);
  assert.equal(forwarded.searchParams.get('last_paid_gclid'), 'TEST-PAID');
  const stored = parseAttribution(latest);
  assert.equal(stored.last_paid_gclid, 'TEST-PAID');
  assert.equal(attributionSourceLabel(stored), 'newsletter / email');
  assert.match(attributionSummary(stored), /Last paid click ID: TEST-PAID/);
  assert.equal(email.events.some(event => event.event), false, 'Capture must not manufacture conversion events');
  const second = visit('/?gclid=TEST-NEW&utm_source=google&utm_medium=cpc', 3);
  assert.equal(second.api.getLatest().last_paid_gclid, 'TEST-NEW');
  assert.equal(second.api.getStore().first_touch.source_type, 'direct');
  const search = visit('/piano-lessons/', 4, 'https://www.google.com/search?q=piano');
  assert.equal(search.api.getLatest().source_type, 'referral');
  assert.equal(search.api.getLatest().gclid, '');
  assert.equal(search.api.getLatest().utm_source, '');
  assert.equal(search.api.getLatest().last_paid_gclid, 'TEST-NEW');
  assert.equal(attributionSourceLabel(search.api.getLatest()), 'Referral: www.google.com');
  assert.equal(visit('/book-intro/', 5).api.getLatest().timestamp, search.api.getLatest().timestamp, 'Direct return retains last non-direct source');
}

// Direct page views do not renew the 90-day click life, even in an open tab.
{
  const visit = browser();
  const paid = visit('/?gclid=TEST-OLD&utm_source=google&utm_medium=cpc');
  const expiry = paid.api.getStore().expires_at;
  assert.equal(visit('/', 60).api.getStore().expires_at, expiry);
  const expired = visit('/book-intro/', 91);
  assert.equal(expired.api.getLatest().gclid, '');
  assert.equal(expired.api.getLatest().last_paid_gclid, '');
  const staleLink = new URL(expired.api.decorateUrl(opus + '?gclid=TEST-OLD&last_paid_gclid=TEST-OLD&_gl=LINKER-TEST'));
  assert.equal(staleLink.searchParams.has('gclid'), false);
  assert.equal(staleLink.searchParams.has('last_paid_gclid'), false);
  assert.equal(staleLink.searchParams.get('_gl'), 'LINKER-TEST', 'Do not remove Google linker data');
  const freshTab = browser()('/?gclid=TEST-OPEN-TAB');
  freshTab.advance(91);
  assert.equal(new URL(freshTab.api.decorateUrl(opus)).searchParams.has('gclid'), false);
}

// Internal navigation and copied browser URLs cannot make the same ID new.
for (const query of ['gclid=TEST-INTERNAL&utm_source=google&utm_medium=cpc', 'wbraid=TEST-BRAID', 'utm_source=google&utm_medium=cpc&utm_campaign=utm-only']) {
  const visit = browser();
  const paid = visit('/piano-lessons/?' + query);
  const timestamp = paid.api.getLatest().last_paid_click_timestamp;
  paid.advance(0.01);
  assert.equal(paid.api.capture().last_paid_click_timestamp, timestamp, 'Repeated form capture is not a new arrival');
  const nextUrl = paid.api.decorateUrl(site + '/book-intro/?service=piano&location=mason');
  const next = visit(nextUrl, 1, site + '/piano-lessons/');
  assert.equal(next.api.getLatest().last_paid_click_timestamp, timestamp);
  assert.equal(next.api.getLatest().timestamp, timestamp);
  const hiddenReferrer = visit(nextUrl, 2);
  assert.equal(hiddenReferrer.api.getLatest().last_paid_click_timestamp, timestamp);
  const stale = visit(nextUrl, 91, site + '/piano-lessons/');
  assert.equal(stale.api.getLatest().last_paid_click_timestamp, '');
}

// Both storage property denial and quota/write denial retain this visit's data.
for (const blocked of ['access', 'writes']) {
  const visit = browser({ blocked });
  const paid = visit('/?gbraid=TEST-BLOCKED&utm_source=google&utm_medium=cpc');
  assert.equal(paid.api.getLatest().last_paid_gbraid, 'TEST-BLOCKED');
  const timestamp = paid.api.getLatest().last_paid_click_timestamp;
  const next = visit(paid.api.decorateUrl(site + '/book-intro/'), 1, site + '/');
  assert.equal(next.api.getLatest().last_paid_gbraid, 'TEST-BLOCKED');
  assert.equal(next.api.getLatest().last_paid_click_timestamp, timestamp);
  assert.equal(next.api.getLatest().first_landing_path, paid.api.getLatest().first_landing_path);
  assert.equal(new URL(next.api.decorateUrl(opus)).searchParams.get('gbraid'), 'TEST-BLOCKED');
  next.api.clear();
  assert.equal(next.api.getLatest().gbraid, '');
}

// v2 upgrade preserves only evidence with a real fresh timestamp.
{
  const touch = { timestamp: new Date(start).toISOString(), gclid: 'TEST-LEGACY', utm_source: 'google', utm_medium: 'cpc' };
  const initial = { csmAttribution: { version: 2, first_touch: touch, latest_touch: { ...touch, timestamp: new Date(start + day).toISOString() }, expires_at: new Date(start + 180 * day).toISOString() } };
  const migrated = browser({ initial })('/', 2);
  assert.equal(migrated.api.getLatest().last_paid_click_timestamp, touch.timestamp);
  assert.equal(migrated.api.getLatest().last_paid_gclid, 'TEST-LEGACY');
  const expired = browser({ initial })('/', 100);
  assert.equal(expired.api.getLatest().last_paid_gclid, '');
  const renewedOldClick = { csmAttribution: { ...initial.csmAttribution, latest_touch: { ...touch, timestamp: new Date(start + 80 * day).toISOString() } } };
  renewedOldClick.csmLessonFitAttribution = renewedOldClick.csmAttribution.latest_touch;
  assert.equal(browser({ initial: renewedOldClick })('/', 100).api.getLatest().gclid, '', 'v2 navigation must not renew a known old click');
}

// Exercise selector validation and native anchor navigation with production config.
{
  const markup = readFileSync(new URL('../src/components/IntroBooking.astro', import.meta.url), 'utf8');
  assert.match(markup, /<a id="viewAvailableTimes"[^>]+href=/);
  const bookingSource = markup.match(/<script define:vars=\{\{ services, locations, defaultService \}\}>([\s\S]*?)<\/script>/)[1];
  const services = INTRO_SERVICES.map(service => ({ slug: service.slug, urls: Object.fromEntries(INTRO_LOCATIONS.map(location => [location.slug, introBookingUrl(service, location)]).filter(([,url]) => url)) }));
  const locations = INTRO_LOCATIONS.map(location => ({ slug: location.slug }));
  const elements = {};
  for (const id of ['availabilityForm', 'introService', 'introLocation', 'viewAvailableTimes', 'officeHelp', 'guidedHelp']) {
    elements[id] = { value: '', listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; }, fire(name) { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.listeners[name](event); return event; } };
  }
  const form = elements.availabilityForm, instrument = elements.introService, school = elements.introLocation, link = elements.viewAvailableTimes;
  school.options = [{ value: '' }, ...locations.map(({ slug }) => ({ value: slug }))];
  form.reportValidity = () => Boolean(instrument.value && school.value);
  let linkClicks = 0;
  link.click = () => { linkClicks++; return link.fire('click'); };
  const paid = browser()('/?gclid=TEST-ANCHOR');
  const window = { CSMAttribution: paid.api, dataLayer: [] };
  vm.runInNewContext(bookingSource, { services, locations, defaultService: '', document: { getElementById: id => elements[id] }, window, location: new URL(site + '/book-intro/'), URL, URLSearchParams });
  assert.equal(link.fire('click').defaultPrevented, true);
  instrument.value = 'piano'; instrument.fire('change');
  school.value = 'mason'; school.fire('change');
  assert.equal(new URL(link.href).pathname, '/w/book-your-piano-intro-mason');
  assert.equal(new URL(link.href).searchParams.get('gclid'), 'TEST-ANCHOR');
  assert.equal(link.fire('click').defaultPrevented, false, 'Valid click must remain native for the linker');
  assert.equal(window.dataLayer.at(-1).event, 'intro_availability_view');
  assert.equal(form.fire('submit').defaultPrevented, true);
  assert.equal(linkClicks, 1, 'Keyboard submit follows the same native anchor');
  instrument.value = 'cello'; school.value = 'anderson'; instrument.fire('change');
  assert.equal(school.value, '');
  assert.equal(link.fire('click').defaultPrevented, true);
  assert.equal(window.dataLayer.some(({ event }) => /lead|submit|purchase/i.test(event)), false);
}

console.log('Attribution journeys, expiry, storage failure, migration, and native booking-link checks passed.');
