/**
 * The horizontal gallery that pins while you scroll.
 *
 * Edit these in the CMS (/admin → Galleries). Add or remove entries freely —
 * the section measures the real width of the track and lengthens itself, and
 * the counter follows.
 *
 *   client  — shown under the frame. Leave blank to show only the number.
 *   caption — the small label across the top of the frame.
 *   tone    — placeholder gradient: 'warm' | 'green' | 'bone' | 'night' | 'dusk'
 *   image   — a photo in public/photos/ (the CMS uploads here). Replaces the gradient.
 */
import data from './galleries.json'

export const galleries = data.items
