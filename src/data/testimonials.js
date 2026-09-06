/**
 * Client words.
 *
 * Edit these in the CMS (/admin → Testimonials). The section only appears on
 * the page once there is at least one entry, so it is safe to launch empty
 * and add real quotes later.
 *
 *   quote   — what they said, without surrounding quotation marks.
 *   name    — who said it.
 *   context — the session, and optionally the place. Shown small under the name.
 */
import data from './testimonials.json'

export const testimonials = data.items
