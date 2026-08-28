# Back-to-School Landing Page Design QA

## Current offer revision

The notebook-paper campaign art direction remains intact, but the retired `$142` offer has been replaced by the approved new-student offer:

- Free Intro Lesson
- 5% off recurring tuition for the first six consecutive months
- $39.90 for a 30-minute lesson during the welcome period
- Automatic return to the standard $42 rate after six months
- A one-time $50 registration fee when a student enrolls in recurring lessons
- Offer valid from July 20–August 31, 2026

The page does not advertise a registration-fee waiver or describe the Intro Lesson as a trial.

## Visual direction

The implementation continues to use the approved warm ruled-paper background, restrained red margin line, navy/teal/coral/mustard palette, strong poster-like headline hierarchy, and the repository's real piano-lesson photography. The exact shared CSM navigation and footer logo assets remain unchanged.

The five location chips stay on one row at the supplied 479px comparison width and reflow cleanly at narrow phone widths.

## Responsive and accessibility verification

Browser QA covered the homepage, lesson pricing, Lesson Fit, Piano Intro, Back-to-School, promos, and parent-resource pricing article.

- 320px phone width: no horizontal overflow on any tested route.
- Required form controls have programmatic labels.
- Primary controls, navigation toggle, and form controls meet the 44px minimum target size.
- Keyboard focus styles and reduced-motion handling remain present.
- Campaign and offer copy remains readable without embedding text in images.
- Desktop layout preserves the balanced campaign hierarchy and existing site shell.

## Tracking and booking protection

The rendered site retains all 23 known location- and instrument-specific Opus Intro routes. Direct booking CTAs use the exact label `Book a Free Intro Lesson`. The shared attribution decorator still carries paid-click IDs, UTM parameters, first/latest landing paths, and attribution timestamp into Opus links and emits `book_intro_click`.

The campaign help form continues to capture its hidden UTM, click-ID, landing-path, and submission-time fields through the existing lead pipeline.

## Result

Draft revision passed design, responsive, accessibility, tracking, and offer-consistency QA. It remains unmerged and is not approved for production until the draft preview is reviewed.
