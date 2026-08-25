const OPUS_ORIGIN = 'https://cincinnatischoolofmusic.opus1.io';

export const INTRO_LOCATIONS = Object.freeze([
  {
    slug: 'mason',
    name: 'CSM Mason',
    opusLocationId: '369181cc-4cd8-40a5-95c5-89eca189d55d'
  },
  {
    slug: 'montgomery',
    name: 'CSM Montgomery',
    opusLocationId: '7d3034f0-01a9-4dbd-84a7-1dc9f5a601e4'
  },
  {
    slug: 'anderson',
    name: 'CSM Anderson',
    opusLocationId: '39fde686-237a-4a20-9039-e49976da2d8c'
  },
  {
    slug: 'maineville',
    name: 'CSM Maineville',
    opusLocationId: '45ec0927-58ad-40ee-9e07-f711b5306cb0'
  },
  {
    slug: 'middletown',
    name: 'CSM Middletown',
    opusLocationId: 'ae5eb81a-8b10-4286-a46e-987779ffbea7'
  }
]);

export const INTRO_SERVICES = Object.freeze([
  {
    slug: 'piano',
    instrument: 'Piano',
    displayName: 'Piano',
    introName: 'Piano Intro Lesson',
    opusServiceId: '567f7305-b997-46cd-b24b-60b129879ef8',
    opusServiceName: 'Piano Private Intro Lesson - 30 mins',
    opusPublicSlug: 'book-your-piano-intro',
    locationSpecificPublicPages: true,
    ageMin: 2,
    ageMax: 99,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  },
  {
    slug: 'music-discovery',
    instrument: 'Music Discovery',
    displayName: 'Music Discovery',
    introName: 'Music Discovery Intro Lesson',
    opusServiceId: '7e24490c-de02-490f-a33b-18860c5e6c2c',
    opusServiceName: 'Music Discovery Intro Lesson - 30 min (ages 3-5)',
    opusPublicSlug: 'book-your-music-discovery-intro',
    locationSpecificPublicPages: true,
    ageMin: 3,
    ageMax: 5,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  },
  {
    slug: 'guitar',
    instrument: 'Guitar',
    displayName: 'Guitar',
    introName: 'Guitar Intro Lesson',
    opusServiceId: 'e09f1dcd-3231-4502-970b-6314ca1cc898',
    opusServiceName: 'Guitar Private Intro Lesson - 30 min',
    opusPublicSlug: 'book-your-guitar-intro',
    locationSpecificPublicPages: false,
    ageMin: 5,
    ageMax: 99,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  },
  {
    slug: 'voice',
    instrument: 'Voice',
    displayName: 'Voice',
    introName: 'Voice Intro Lesson',
    opusServiceId: '95e7a5e8-1c0d-40a7-969a-d95e2add26ea',
    opusServiceName: 'Voice Private Intro Lesson - 30 min',
    opusPublicSlug: 'book-your-voice-intro',
    locationSpecificPublicPages: false,
    ageMin: 2,
    ageMax: 99,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  },
  {
    slug: 'violin',
    instrument: 'Violin',
    displayName: 'Violin',
    introName: 'Violin Intro Lesson',
    opusServiceId: '36269f6c-9092-4c9a-a6f9-d2f8688f4c85',
    opusServiceName: 'Violin Private Intro Lesson - 30 min',
    opusPublicSlug: 'book-your-violin-intro',
    locationSpecificPublicPages: false,
    ageMin: 2,
    ageMax: 99,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  },
  {
    slug: 'drums',
    instrument: 'Drums',
    displayName: 'Drums',
    introName: 'Drums Intro Lesson',
    opusServiceId: '3252333e-2590-4a98-937d-cd71b8d3934b',
    opusServiceName: 'Drums Private Intro Lesson - 30 mins',
    opusPublicSlug: 'book-your-drum-intro',
    locationSpecificPublicPages: false,
    ageMin: 2,
    ageMax: 99,
    priceCents: 4200,
    currency: 'usd',
    durationMinutes: 30
  }
]);

const SERVICE_ALIASES = Object.freeze({
  mdl: 'music-discovery',
  'early-childhood': 'music-discovery',
  drum: 'drums',
  percussion: 'drums',
  strings: 'violin'
});

export function introLocation(value) {
  const requested = String(value || '').trim().toLowerCase();
  return INTRO_LOCATIONS.find((location) =>
    location.slug === requested || location.name.toLowerCase() === requested || location.opusLocationId === requested
  ) || null;
}

export function introService(value) {
  const requested = String(value || '').trim().toLowerCase();
  const aliased = SERVICE_ALIASES[requested] || requested;
  return INTRO_SERVICES.find((service) =>
    service.slug === aliased ||
    service.instrument.toLowerCase() === aliased ||
    service.opusServiceId.toLowerCase() === aliased
  ) || null;
}

export function introServiceFromText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  return INTRO_SERVICES.find((service) => {
    if (text.includes(service.opusServiceId.toLowerCase())) return true;
    if (text.includes(service.opusServiceName.toLowerCase())) return true;
    if (service.slug === 'music-discovery') return /music\s+discovery/.test(text) && /intro|single\s+visit/.test(text);
    if (service.slug === 'drums') return /drum|percussion/.test(text) && /intro|single\s+visit/.test(text);
    return new RegExp(`${service.slug}[^|]{0,100}(intro|single\\s+visit)|(intro|single\\s+visit)[^|]{0,100}${service.slug}`).test(text);
  }) || null;
}

export function introBookingUrl(serviceValue, locationValue) {
  const service = typeof serviceValue === 'object' ? serviceValue : introService(serviceValue);
  const location = typeof locationValue === 'object' ? locationValue : introLocation(locationValue);
  if (!service || !location) return '';
  if (service.locationSpecificPublicPages) {
    return `${OPUS_ORIGIN}/w/${service.opusPublicSlug}-${location.slug}`;
  }
  const params = new URLSearchParams({
    serviceId: service.opusServiceId,
    locationId: location.opusLocationId,
    selfRequest: 'True',
    planName: 'Single Visit - Intro'
  });
  return `${OPUS_ORIGIN}/selfbook?${params.toString()}`;
}

export const INTRO_BRIDGE_PUBLIC_PATH = '/book-intro/';

export function introBridgePath({ service, location } = {}) {
  const params = new URLSearchParams();
  const resolvedService = introService(service);
  const resolvedLocation = introLocation(location);
  if (resolvedService) params.set('service', resolvedService.slug);
  if (resolvedLocation) params.set('location', resolvedLocation.slug);
  const query = params.toString();
  return query ? `${INTRO_BRIDGE_PUBLIC_PATH}?${query}` : INTRO_BRIDGE_PUBLIC_PATH;
}
