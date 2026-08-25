export const PIANO_BOOKING_LOCATIONS = Object.freeze([
  {
    slug: 'montgomery',
    name: 'CSM Montgomery',
    bookingUrl: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-montgomery'
  },
  {
    slug: 'mason',
    name: 'CSM Mason',
    bookingUrl: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-mason'
  },
  {
    slug: 'anderson',
    name: 'CSM Anderson',
    bookingUrl: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-anderson'
  },
  {
    slug: 'maineville',
    name: 'CSM Maineville',
    bookingUrl: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-maineville'
  },
  {
    slug: 'middletown',
    name: 'CSM Middletown',
    bookingUrl: 'https://cincinnatischoolofmusic.opus1.io/w/book-your-piano-intro-middletown'
  }
]);

export function pianoBookingLocation(value) {
  const requested = String(value || '').trim().toLowerCase();
  return PIANO_BOOKING_LOCATIONS.find((location) =>
    location.slug === requested || location.name.toLowerCase() === requested
  ) || null;
}
