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

| Section in the CMS | File(s) it writes | What it controls |
|---|---|---|
| Site & page text | `src/data/site.json` | Business name, contact links, nav, and every headline/paragraph on the page |
| Packages          | `src/data/packages.json` | The package cards and the pricing list (same data feeds both) |
| Galleries         | `src/content/galleries/*.json` | One entry per gallery — see below |

Saving commits to GitHub on the `main` branch, and Netlify redeploys within a
minute or two. Photos you upload in the CMS land in `public/photos/`.

### Galleries

Each entry in **Galleries** is its own file and its own page on the site at
`/gallery/<file-name>` (e.g. `/gallery/prewedding-paris`). To add one, click
**New Gallery**, fill in:

- **Caption** — the small label (e.g. "Pre-wedding — Paris"). Required.
- **Title** — optional; the big heading on the gallery page. Falls back to the caption.
- **Date** — controls the order. The home-page strip lists galleries newest first.
- **Cover photo** — the frame shown in the strip on the home page.
- **Photos** — click *Add Photo* for each image. These are what visitors see on
  the gallery page (click any photo to open it full-screen).

A gallery with no photos yet still gets a page — it just says the photos are on
their way. Delete a gallery to remove its page and its frame from the strip.

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
  main.jsx              entry point (router lives here)
  App.jsx               routes + shared Nav / Footer
  pages/
    Home.jsx            the one-page site, section by section
    GalleryPage.jsx     /gallery/<slug> — photo grid + lightbox
  lib/lines.js          splits a headline field into its visual lines
  data/                 COPY AND LINKS (edited via /admin)
    site.json           brand, contact, nav, headlines
    packages.json       what you photograph
    *.js                thin re-exports so components import a stable name
  content/
    galleries/          one JSON file per gallery
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

Easiest through the CMS (Packages → Photo, or Galleries → a gallery → Photos).
By hand: drop files in `public/photos/` and set the path to `/photos/your-file.jpg`.

Where no photo is set, a tinted gradient placeholder stands in. Export at about
2000px on the long edge and compress — the strip and package shots run
full-bleed, so weight matters.

## Animation

Framer Motion, so most additions are one wrapper:

```jsx
import Reveal from './components/Reveal.jsx'

<Reveal delay={0.1}>…anything…</Reveal>      // fade and rise into view
<MaskLine>One line of display type</MaskLine> // slides up out of a mask
```

Timings and curves live in two mirrored places — `src/motion.js` for
Framer Motion, the `--ease` / `--dur-*` tokens in `src/styles/tokens.css` for
CSS. Change them together; don't hand-type a new curve.

Rules worth keeping:

- **One line per `MaskLine`.** A two-line string inside a single mask gets its
  descenders clipped, and separate masks let the lines stagger.
- **Parallax is bounded.** `Photo` insets its fill by 16% and drifts at most 12%,
  so the edge never shows. Raising `parallax` past `0.12` will expose it.
- **Hover and press effects use `scale` / `translate`, never `transform`.**
  `Reveal` and `MaskLine` leave `transform` written inline on the element, which
  silently overrides any CSS `transform` on the same element. The individual
  properties compose with it instead. (This is why the Investment rows' hover
  shift never used to show.)
- **Every `:hover` sits inside `@media (hover: hover) and (pointer: fine)`.**
  On touch, an ungated hover sticks after a tap.
- **Everything pressable has an `:active` state**, and it fires on press, not
  release. That is the only feedback a phone user gets.
- **UI timings stay short.** Press 160ms, colour 200ms, small movement 240ms.
  Scroll reveals are editorial and are allowed to be slower; hovers are not.
- **Anything the reader can grab or reverse uses a spring** (`SPRING` in
  `motion.js`) — the nav, the lightbox, the gallery strip's coast. Springs
  start from where the element actually is and keep its velocity.

Everything honours `prefers-reduced-motion`: slides become cross-fades, the
lightbox and nav stop moving, and nothing is removed outright.

---

## The tour (3D)

The home page is the tour. It works like a film: the page doesn't scroll
until the visitor finishes the experience or leaves it (Exit), and scrolling
moves the story instead — the next photo, the previous one, on to the next
memory.

1. **Landing** — the LOSPIKIR logo with a short introduction, **Start the
   experience** and **Skip the tour** (the regular site at `/work`). The
   default is the site's black; `?landing=photo` (or `#landing-photo`) puts
   the CMS hero photo behind it instead.
2. **Memories** — every project as a large Instax print, pegged to a wire of
   fairy lights in a dark room; drag, swipe or use the arrow keys along it.
   The centred print's name is written large, with what kind of shoot and
   where ("Pre-wedding · Paris"). Click it to step in. On the last
   print: **Finish the experience**.
3. **Into the place** — the print flies to the middle at its true size and
   the 3D place develops around it. Arrows either side, a counter beneath,
   and on the left the story of a session moving on as the photos do ("We
   meet in Paris. No rush." …). Scrolling past the last photo moves on
   to the next memory.
4. **Finished or Exit** — the experience fades out and the page scrolls on to
   ways to work together, pricing and the enquiry, in the regular site's
   style.

**Sound.** Starts with the experience (there's always a Sound on/off button):
a soft generated soundtrack plus each place's own ambience — waves and wind on
the dunes, a city's hum, water at night, the party deck's bass. Made in the
browser, so nothing to license. To use a real track you have the rights to,
upload it in the CMS under Site settings → The experience → Music file.

**Words.** The introduction, button labels, the memories line and the story
lines are in the CMS (Site settings → The experience). A gallery can have its
own story (Galleries → Story for the experience); otherwise the general one is
used, with `{place}` replaced by the gallery's place.

The photos are shown as plain full-quality images — no frame, no grain, no
filter. Right-click saving and dragging are switched off and every photo
carries a small © LOSPIKIR credit; the logo is always in the navigation bar.

Gallery pages open straight into their own place; "View as a regular gallery"
jumps to the grid.

**The look.** Everything is generated in code (no downloaded models or
textures): physically based materials painted with relief and roughness
(`materials.js`: brick, plaster, concrete, paving, roofs, glass that mirrors
the sky…), branching trees with real leaves (`trees.js`), each place lit by its
own sky (an environment map), shadows, soft ambient occlusion that respects
edges, bloom on bright lights, sun rays, realistic water and a filmic curve
(`post.js`).

**Colours match the photos.** Each place's sky is read from its photos, and
the whole place gets a gentle white balance and saturation taken from them
(`palette.js`). Night and indoor places keep their own light.

### Editing it in the CMS (`/admin` → Galleries)

| Field | What it does |
|---|---|
| **Place** | The 3D world: Paris, Amsterdam canals, Leidseplein, Dunes and beach, University campus (TU/e), Erasmus University, Eindhoven (the Blob), City waterfront at sunset / at night, On the water at night (party boat), Light-filled country house, Studio, Graduation hall, or None. |
| **Where it was shot** | Your note of the exact spot, e.g. "Trocadéro, Paris". Not shown to visitors (the story uses it only when City is empty). |
| **Several places in one shoot** | When a shoot moved (City Hall, then the dunes), list each place with its photo numbers; the experience moves from one place to the next as the photos do. |
| **City** | What the experience shows ("Pre-wedding · Paris") — only the city, never the exact spot. Empty shows just the type of shoot. |
| **The moment** | The photo on the print, and the first one shown; the sky is read from it. A project needs both a Place and a Moment to appear in the tour. |
| **Describe the moment photo** | Alt text for screen readers and Google. |
| **Home-page position** | 1, 2, 3… sets the order in the tour. Other projects with a place and moment follow. |

A new project just needs a Place and a Moment — no 3D work.

### Who sees what

Visitors get the same browsing over a softly blurred photo instead of 3D when
they've asked their device for reduced motion, have Data Saver on, or their
browser has no WebGL 2. Add `?classic` to any URL to see it yourself. Phones get
a lighter version (lower resolution, fewer trees and grass, simpler occlusion,
fewer places kept in memory).

### Where the code is

```
src/immersive/
  Journey.jsx        the tour's screens: landing, memories, place view
  viewer.js          three.js renderer: loads places, glides between viewpoints
  post.js            occlusion, bloom, sun rays, film curve, colour grade, reveal
  palette.js         reads sky colours and the colour grade out of the photos
  world.js           painted sky, light presets, water, lamps, night windows
  materials.js       procedural PBR surfaces (brick, plaster, paving, glass…)
  trees.js           branching trees with leaf cards, by species and season
  scenes/            one file per place (paris, amsterdam, leidseplein, coast,
                     campus, erasmus, eindhoven, waterfront, interior, hall)
                     + index.js to register new ones
  soundscape.js      the generated soundtrack and each place's ambience
  shutter-sound.js   the shutter click, synthesised (no audio file)
src/styles/journey.css
```


### Privacy and tracking

The site sets **no cookies** and has no ad trackers, so no cookie banner is
needed. Visitor statistics are optional: create a site at plausible.io, then in
Netlify add the environment variable `VITE_PLAUSIBLE_DOMAIN=lospikir.com` and
redeploy. The privacy page (`/privacy`) updates itself to say so. Have the
privacy text checked before relying on it.

## Typeface

Set in **Helvetica Neue**, taken from the logo. It is a system face on macOS and
iOS but falls back to Arial on Windows and Android — roughly half of visitors.
To fix: drop a webfont into `public/fonts/`, add the `@font-face` rules to
`src/styles/tokens.css`, and update `--font`. Free options that sit much closer
to Helvetica than Arial: **Inter Tight** or **Archivo**.

## Photo originals

`originals/` holds the full-resolution files, kept out of git (see `.gitignore`).
The web copies in `public/photos/` are resized to 1800px on the long edge and
compressed. To add more later, the CMS handles the resize on upload; by hand,
keep them small.

## Still to do

- [ ] Brochure PDF at `public/brochure/lospikir-guide.pdf` (or upload via the CMS)
- [ ] Picflow client-gallery URL (Site & page text → Contact & links)
- [ ] Check the auto-generated gallery captions / titles / order in `/admin`
- [ ] Confirm the package copy — turnaround times, inclusions
- [ ] `og-image.jpg` in `public/` for link previews
- [ ] Typeface decision above
- [ ] Netlify Forms email notification for enquiries
- [ ] Check the places I couldn't identify from the photos: Alyssa Nadia, Amara (master's) — set *Where it was shot* in the CMS
- [ ] Optional: Plausible statistics (see *Privacy and tracking*)
