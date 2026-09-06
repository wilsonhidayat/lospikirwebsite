/**
 * What you photograph.
 *
 * Edit these in the CMS (/admin → Packages). Order matters: the card grid and
 * the Investment list are both numbered from position, so reordering here
 * renumbers both. Nothing else needs changing when you add or remove one.
 *
 *   tone   — placeholder gradient until a real photo is set:
 *            'warm' | 'green' | 'bone' | 'night' | 'dusk'
 *   image  — a photo in public/photos/ (the CMS uploads here). Replaces the gradient.
 *   ask    — true renders the open-ended outlined card, with no photo.
 *   specs  — the one-line summary reused in the Investment list.
 */
import data from './packages.json'

export const packages = data.items
