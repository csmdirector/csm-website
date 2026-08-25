import { INTRO_LOCATIONS, introBookingUrl, introLocation } from './intro-bridge-config.js';

const PIANO_LOCATION_ORDER = ['montgomery', 'mason', 'anderson', 'maineville', 'middletown'];

export const PIANO_BOOKING_LOCATIONS = Object.freeze(PIANO_LOCATION_ORDER.map((slug) => {
  const location = INTRO_LOCATIONS.find((item) => item.slug === slug);
  return {
    slug: location.slug,
    name: location.name,
    bookingUrl: introBookingUrl('piano', location)
  };
}));

export function pianoBookingLocation(value) {
  const location = introLocation(value);
  return location
    ? PIANO_BOOKING_LOCATIONS.find((item) => item.slug === location.slug) || null
    : null;
}
