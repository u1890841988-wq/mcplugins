# Plugin List

A dark, animated Minecraft plugin discovery website built as a normal static GitHub repo. It searches live results from Modrinth and Spigot, lets you filter by source, platform, version, and price, and supports bookmark saving for later.

## Features

- Live plugin search across Modrinth and Spigot
- Multi-word matching like “Skript Shop”
- Source, platform, price, and version filters
- Sort by relevance, downloads, popularity, and recency
- Save bookmarks locally in the browser
- Responsive black/pink design for desktop and mobile

## Repo layout

- `index.html` — app shell and UI
- `styles.css` — design system, animations, dark theme
- `app.js` — live fetch logic, filters, rendering, bookmarks

## Run locally

From the repository root:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## GitHub Pages deployment

This app is already designed as a standard static site, so it works well with GitHub Pages:

1. Push this repo to GitHub.
2. Open the repository on GitHub.
3. Go to Settings → Pages.
4. Choose the default branch and root folder.
5. Save and wait for the deployment to finish.

## Notes

- BuiltByBit is intentionally not included in the browser-facing data layer because direct requests are blocked by Cloudflare/403 protections.
- The app is intentionally client-side and does not require a backend or build step.
