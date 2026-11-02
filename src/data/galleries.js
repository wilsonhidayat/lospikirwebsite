/**
 * Galleries.
 *
 * One file per gallery in src/content/galleries/ — add, edit and remove them in
 * the CMS (/admin → Galleries). Each becomes its own page at /gallery/<slug>,
 * where <slug> is the file name. The home-page strip lists them newest first.
 */
const files = import.meta.glob('../content/galleries/*.json', { eager: true })

export const galleries = Object.entries(files)
  .map(([path, mod]) => {
    const slug = path.split('/').pop().replace(/\.json$/, '')
    const data = mod.default ?? mod
    return {
      slug,
      title: data.title || '',
      caption: data.caption || '',
      date: data.date || '',
      tone: data.tone || 'warm',
      cover: data.cover || null,
      intro: data.intro || '',
      // the immersive opening: which place to fly into, and the photograph
      // it resolves into (defaults to the cover)
      scene: data.scene && data.scene !== 'none' ? data.scene : null,
      place: data.place || '',
      hero: data.hero || data.cover || null,
      alt: data.heroAlt || '',
      featured: Number(data.featured) || 0,
      photos: Array.isArray(data.photos) ? data.photos.filter((p) => p && p.src) : [],
    }
  })
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))

export function galleryBySlug(slug) {
  return galleries.find((g) => g.slug === slug) ?? null
}

/**
 * Projects that get a chapter in the home-page experience, in the order set
 * by their "featured" number (1 first). Only galleries with a place and a
 * photograph qualify.
 */
export const featuredGalleries = galleries
  .filter((g) => g.featured > 0 && g.scene && g.hero)
  .sort((a, b) => a.featured - b.featured)
