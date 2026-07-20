# Back-to-School Landing Page Design QA

## Comparison setup

- Source visual truth:
  - `/tmp/codex-remote-attachments/019f80f4-8b41-7351-969c-fe06b3b65e52/C7DA4290-F1D1-445E-BA8D-74A57A7B0D37/1-Photo-1.jpg`
  - `/tmp/codex-remote-attachments/019f80f4-8b41-7351-969c-fe06b3b65e52/C7DA4290-F1D1-445E-BA8D-74A57A7B0D37/2-Photo-2.jpg`
- Browser-rendered implementation evidence:
  - `/tmp/csm-bts-desktop.png`
  - `/tmp/csm-bts-desktop-offers.png`
  - `/tmp/csm-bts-desktop-form.png`
  - `/tmp/csm-bts-mobile-320.png`
  - `/tmp/csm-bts-mobile-form.png`
  - `/tmp/csm-bts-thank-you-mobile.png`
- Viewports: 1440 × 900 desktop and 320 × 844 mobile.
- State: initial campaign page, tracked quarter-page URL, tracked half-page URL, `#claim` state, filled local form controls without submission, mobile navigation open/closed, and thank-you page.

## Full-view comparison evidence

The wide and tall source ads were opened in the same visual comparison input as the desktop and 320px browser captures. The implementation preserves the source hierarchy and art direction: warm ruled notebook paper, one restrained red margin rule, condensed navy/teal campaign type, navy school-year banner, oversized coral `$142 OFF`, mustard deadline treatment, and real piano-lesson photography. The web layout intentionally separates the offer stack from the hero and stacks the photo below the CTA on mobile, matching the requested page structure and responsive behavior rather than copying the print ad's QR composition.

## Focused comparison evidence

- Hero: `/tmp/csm-bts-desktop.png` and `/tmp/csm-bts-mobile-320.png` confirm the headline, offer, CTA, deadline, and photo hierarchy against both source references. At 320px, the CTA ends at 497px and remains visible in the first 844px viewport.
- Offer stack and trust bands: `/tmp/csm-bts-desktop-offers.png` confirms all three offers, values, inline icons, mustard deadline strip, and navy trust band are legible and visually consistent with the source palette.
- Form: `/tmp/csm-bts-desktop-form.png` and `/tmp/csm-bts-mobile-form.png` confirm clear labels, strong focus indication, readable controls, 48px inputs, a 54px submit control, and no horizontal overflow.
- Thank-you state: `/tmp/csm-bts-thank-you-mobile.png` confirms the campaign styling, required copy, and 48px contact actions at 320px.

## Required fidelity surfaces

- Fonts and typography: Heavy condensed system display faces recreate the source's editorial poster hierarchy without embedding text in imagery. Jost remains the clean site body/form face. Weight, line height, letter spacing, wrapping, and mobile scale remain readable at 320px.
- Spacing and layout rhythm: Desktop uses a balanced split hero; mobile stacks copy, CTA, then photography. Offer rows, trust bands, proof copy, and form spacing remain distinct and do not collide or clip. Client width and scroll width both measured 1440 on desktop and 320 on mobile.
- Colors and visual tokens: Navy, teal, coral, mustard, warm paper, pale blue rules, and the restrained coral margin rule closely map to the source direction. Contrast is strong for campaign headings, buttons, body text, and form controls.
- Image quality and asset fidelity: The implementation uses `/images/promo-piano-lesson.jpg`, the repository's real CSM student/teacher asset, with meaningful alt text and stable intrinsic dimensions. The exact shared navigation/footer logo assets remain untouched. The reference model photo was treated as art-direction context rather than introduced as a new or generated stock image.
- Copy and content: Campaign name, `$142` total, all three offer components and values, August 31, 2026 deadline, supporting copy, trust facts, form labels, terms, and thank-you copy match the brief. No copy says or implies that the first month is free.
- Icons: The three user-required inline SVG icons are consistent in size, fill, circular treatment, and alignment.
- Accessibility and behavior: Labels and semantic controls are present, focus states are visible, tap targets exceed 44px, reduced motion is respected, alt text is meaningful, and there is no horizontal overflow at 320px. Mobile navigation opens/closes and reports `aria-expanded` correctly; the CTA reaches `#claim`.

## Browser and interaction results

- Both tracked print query strings populated `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, and the full `landing_path` in the hidden fields.
- All seven required controls were present; text inputs accepted values and both required selects changed values.
- The real logo source resolved to `/images/CSM_2.0_Full_Lockup_Black.svg`.
- No browser console errors occurred. Repeated Astro development navigations produced Meta's existing duplicate pixel-ID warning even though the rendered page contains only one Pixel initialization; this is not introduced by the campaign route.

## Findings

No actionable P0, P1, or P2 design mismatches remain.

## Open questions

None.

## Implementation checklist

- [x] Match approved notebook/ad direction.
- [x] Preserve exact current site logo and shell.
- [x] Keep the offer and CTA above the fold on 320px mobile.
- [x] Verify offer stack, trust content, form, and thank-you views.
- [x] Verify core interactions, attribution fields, focus state, tap targets, and overflow.

## Comparison history

Pass 1: The initial browser-rendered implementation was compared with both supplied print references at desktop and mobile viewports. No P0/P1/P2 issues were found, so no visual correction loop was required.

## Follow-up polish

No P3 items are required for launch.

final result: passed
