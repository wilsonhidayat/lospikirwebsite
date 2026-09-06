# Lospikir

Portrait, pre-wedding and graduation photography — Wilson Hidayat, Netherlands.

Vite + React + Framer Motion. HTML, CSS and JavaScript are kept in separate
files; no styles are written inside components. All copy and links live in
`src/data/` and are editable through a CMS at `/admin`.

---

## Running it

```bash
npm install     # once
npm run dev     # http://localhost:5173
npm run build   # production build into dist/
npm run preview # serve the built site locally
```

Requires Node 18 or newer (Netlify is pinned to Node 20 in `netlify.toml`).

## Deploying to Netlify

1. Push this folder to the GitHub repo `wilsonhidayat/lospikirwebsite`.
2. In Netlify, **Add new site → Import an existing project**, pick the repo.
3. The build command (`npm run build`) and publish directory (`dist`) are read
   from `netlify.toml` — nothing to type.
4. Point `lospikir.com` at the site under **Domain management**, then remove
   the Squarespace DNS records once the new site resolves.

---

## Editing content — the CMS

Go to **`https://<your-site>/admin/`** and sign in with GitHub. Login uses
Sveltia CMS's hosted OAuth, so there is nothing to deploy for it — the first
time, GitHub will ask you to authorise the app.

You can edit:

| Section in the CMS | File it writes | What it controls |
|---|---|---|
| Site & page text | `src/data/site.json` | Business name, contact links, nav, and every headline/paragraph on the page |
| Packages          | `src/data/packages.json` | The package cards and the pricing list (same data feeds both) |
| Gallery           | `src/data/galleries.json` | The frames in the pinned horizontal gallery |
| Testimonials      | `src/data/testimonials.json` | Client quotes. The section is hidden on the site until there is at least one |

Saving commits to GitHub on the `main` branch, and Netlify redeploys within a
minute or two. Photos you upload in the CMS land in `public/photos/`.

**Headlines wrap where you press Enter.** A headline field with two lines
renders as two animated lines on the page; the trailing hero line is styled
separately in *Site & page text → Hero → Final line*.

### Editing content locally (before / without deploying)

```bash
npm run dev
```

Open **http://localhost:5173/admin/** in **Chrome or Edge** and click
**"Work with Local Repository"**, then pick this project folder. Sveltia edits
the files on disk directly — no login, no proxy server. Refresh the site tab to
see your changes. (The folder-picker needs Chrome/Edge; it is not in Safari or
Firefox.)

A small dev-only shim in `vite.config.js` serves `/admin/` during `npm run dev`;
Netlify serves it without help.

### Notes for later

- `public/admin/index.html` loads Sveltia CMS unpinned. Once you are live it is
  worth pinning a version — see the comment in that file.
- If GitHub login ever fails on the deployed site, you can self-host the tiny
  OAuth endpoint (a Cloudflare Worker) and set `base_url:` in
  `public/admin/config.yml`. Not needed for now.

---

## Where things live

```
index.html              page shell, <title>, meta, and the hidden Netlify form
netlify.toml            build + headers + redirects
public/
  admin/                the CMS (index.html + config.yml)
  logo-black.png        wordmark, ink on light
  logo-bone.png         wordmark, light on ink
  brochure/             put lospikir-guide.pdf here
  photos/               photographs (the CMS uploads here)
src/
  main.jsx              entry point
  App.jsx               section order — reorder the page here
  lib/lines.js          splits a headline field into its visual lines
  data/                 ALL COPY AND LINKS (edited via /admin)
    site.json           brand, contact, nav, headlines
    packages.json       what you photograph
    galleries.json      the horizontal gallery
    testimonials.json   client quotes
    *.js                thin re-exports so components import a stable name
  components/           one file per section
  hooks/                scroll helpers
  styles/               one stylesheet per component
    tokens.css          colours, type, radii — change the look here
    base.css            reset, type scale, buttons, photo blocks
```

## The enquiry form

`src/components/Enquire.jsx` renders the form; it submits to **Netlify Forms**.
Netlify detects the form from the hidden static copy in `index.html` at build
time — **if you change a field, change it in both places** (same `name`).

Submissions appear in the Netlify dashboard under **Forms → enquiry**. Set up
an email notification there: **Forms → Settings → Form notifications**.

## Adding photographs

Easiest through the CMS (Packages / Gallery → Photo). By hand: drop files in
`public/photos/` and set `image` to `/photos/your-file.jpg` in the JSON.

Until `image` is set, a tinted gradient placeholder stands in. Export at about
2000px on the long edge and compress — these are full-bleed, so weight matters.

## Animation

Framer Motion, so most additions are one wrapper:

```jsx
import Reveal from './components/Reveal.jsx'

<Reveal delay={0.1}>…anything…</Reveal>      // fade and rise into view
<MaskLine>One line of display type</MaskLine> // slides up out of a mask
```

Two rules worth keeping:

- **One line per `MaskLine`.** A two-line string inside a single mask gets its
  descenders clipped, and separate masks let the lines stagger.
- **Parallax is bounded.** `Photo` insets its fill by 16% and drifts at most 12%,
  so the edge never shows. Raising `parallax` past `0.12` will expose it.

Everything honours `prefers-reduced-motion` through Framer's `useReducedMotion`.

## Typeface

Set in **Helvetica Neue**, taken from the logo. It is a system face on macOS and
iOS but falls back to Arial on Windows and Android — roughly half of visitors.
To fix: drop a webfont into `public/fonts/`, add the `@font-face` rules to
`src/styles/tokens.css`, and update `--font`. Free options that sit much closer
to Helvetica than Arial: **Inter Tight** or **Archivo**.

## Still to do

- [ ] Real photographs (via `/admin`, or `public/photos/`)
- [ ] Brochure PDF at `public/brochure/lospikir-guide.pdf`
- [ ] Picflow client-gallery URL (Site & page text → Contact & links)
- [ ] Confirm the package copy — turnaround times, photo counts, inclusions
- [ ] Two real client quotes (Testimonials in `/admin`) — worth more than any design change
- [ ] `og-image.jpg` in `public/` for link previews
- [ ] Typeface decision above
- [ ] Netlify Forms email notification for enquiries
