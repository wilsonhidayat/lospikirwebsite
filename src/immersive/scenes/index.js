/**
 * The places a project can be set in. A gallery's `scene` field (editable in
 * the CMS) picks one; each loads only when it's needed.
 *
 * Add a new place: write scenes/<name>.js exporting a builder that returns
 * { scene, world, path: { positions, targets, fov }, update(t) }, then list it
 * here and in public/admin/config.yml.
 */
export const SCENE_LABELS = {
  paris: 'Paris',
  amsterdam: 'Amsterdam canals',
  coast: 'Dunes and beach',
  campus: 'University campus',
  'waterfront-sunset': 'City waterfront at sunset',
  'waterfront-night': 'City waterfront at night',
  'party-boat': 'On the water at night',
  interior: 'Light-filled interior',
  studio: 'Studio',
}

const LOADERS = {
  paris: (T, ctx) => import('./paris.js').then((m) => m.buildParis(T, ctx, { light: 'overcast' })),
  amsterdam: (T, ctx) => import('./amsterdam.js').then((m) => m.buildAmsterdam(T, ctx, { light: 'golden' })),
  coast: (T, ctx) => import('./coast.js').then((m) => m.buildCoast(T, ctx, { light: 'sunset' })),
  campus: (T, ctx) => import('./campus.js').then((m) => m.buildCampus(T, ctx, { light: 'overcast' })),
  'waterfront-sunset': (T, ctx) =>
    import('./waterfront.js').then((m) => m.buildWaterfront(T, ctx, { light: 'sunset', lookout: true })),
  'waterfront-night': (T, ctx) =>
    import('./waterfront.js').then((m) => m.buildWaterfront(T, ctx, { light: 'night', bridge: true })),
  'party-boat': (T, ctx) =>
    import('./waterfront.js').then((m) => m.buildWaterfront(T, ctx, { light: 'night', partyBoat: true, bridge: false })),
  interior: (T, ctx) => import('./interior.js').then((m) => m.buildInterior(T, ctx, { variant: 'loft' })),
  studio: (T, ctx) => import('./interior.js').then((m) => m.buildInterior(T, ctx, { variant: 'studio' })),
}

export function hasScene(key) {
  return !!key && key in LOADERS
}

export function loadScene(key, THREE, ctx) {
  const load = LOADERS[key] || LOADERS.studio
  return load(THREE, ctx)
}
