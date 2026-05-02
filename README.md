# Cincinnati School of Music — Website

Production source for [cincinnatischoolofmusic.com](https://cincinnatischoolofmusic.com).

Static site — plain HTML, no build step, no framework. Hosted on Netlify.

## Branches

- **`main`** — production. Deploys to cincinnatischoolofmusic.com automatically when changes are merged in.
- **`staging`** — preview/review. Pushes here generate a Netlify deploy preview at a `*.netlify.app` URL for review before merging to `main`.

## Repo structure

```
.
├── *.html              — 33 page files at the root (each URL maps directly)
├── images/             — all site imagery
├── _redirects          — Netlify URL redirects (legacy .php URLs, /home, etc.)
└── README.md           — this file
```

URLs map directly to filenames: `piano-lessons.html` is served at `/piano-lessons`.

## Making a change

### Small change (single page text/image edit)

1. Switch to the `staging` branch:
   ```
   git checkout staging
   git pull
   ```
2. Edit the file, save, commit, and push:
   ```
   git add path/to/file.html
   git commit -m "describe the change"
   git push
   ```
3. Netlify generates a deploy preview within ~30 seconds. Preview URL appears in the GitHub PR or the Netlify dashboard.
4. Review the preview. If it looks right, merge `staging` into `main`:
   ```
   git checkout main
   git merge staging
   git push
   ```
5. Production deploys automatically.

### Larger change (multiple pages, new page, structural)

Same flow, but open a Pull Request from `staging` → `main` instead of merging directly. The PR view shows every line that changed and gives a deploy preview link before merge.

## Rollback

Netlify keeps every previous deploy. To revert production to a known-good state:

1. Open Netlify → Site → **Deploys**
2. Find the last deploy that was working
3. Click **Publish deploy** on that entry

The site rolls back in seconds. The git history is unchanged — fix the bug in `staging` and re-deploy normally.

To roll back at the git level (more invasive):
```
git checkout main
git revert <bad-commit-sha>
git push
```

## What NOT to commit directly to `main`

Always go through `staging` first. Direct pushes to `main` skip the preview step, which is the whole point of having two branches. The only exception is rollback via the Netlify UI, which doesn't touch git at all.

## Tracking & analytics

Sitewide tracking is hardcoded into every HTML page's `<head>` (GA4, GTM, Facebook Pixel, site verification metas) and `<body>` (GTM noscript, FB noscript). Don't edit these blocks per-page — if a tracking change is needed, it should be applied across all 33 pages at once.
