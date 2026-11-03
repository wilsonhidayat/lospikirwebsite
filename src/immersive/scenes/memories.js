/**
 * Memories, as a place: a travel map on a desk at golden hour.
 *
 * A large printed map of the Low Countries down to Paris — coastline, the
 * Wadden islands, the IJsselmeer, Zeeland's estuaries, the Rhine, Maas,
 * Schelde and Seine, borders, railways, relief, towns and their names, a
 * title cartouche and a compass rose, all drawn on warm, folded paper — lies
 * on a dark walnut desk. Every shoot is an instant print standing in a little
 * wooden stand at its city, showing its photograph; a red thread runs between
 * them in story order. A brass lamp, a film camera, an open notebook, lens
 * caps, a film canister and a cup of coffee sit at the edges. Low sun comes in
 * through a window on the left (window-bar shadows, a dusty light shaft),
 * the lamp throws a warm pool on the map.
 *
 *   buildMemoryMap(THREE, ctx) → { scene, world, path, update, memorySpot }
 *   ctx.memories: [{ slug, title, hero, city, lat, lon }] in story order
 *   path.spots[0]     the whole desk and map
 *   path.spots[i + 1] memory i, framed low across the map
 *
 * Built at desk scale: modelled in real metres inside a group scaled by S, so
 * the shared post-processing (occlusion radius, shadow biases — tuned for
 * buildings) reads it like a room-sized place.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createWorld, NOISE_GLSL } from '../world.js'
import * as M from '../materials.js'
import { seeded, range, glowTexture, noiseNormalMap } from '../utils.js'

const S = 20 // world units per real metre

/* --- the map's geography ----------------------------------------------------- */

// equirectangular around 51.1°N
const LON0 = 1.3
const LON1 = 7.4
const LAT0 = 48.55
const LAT1 = 53.65
const MAP_W = 0.7 // printed area, metres
const MAP_H = (MAP_W * (LAT1 - LAT0)) / ((LON1 - LON0) * Math.cos((51.1 * Math.PI) / 180))
const MARGIN = 0.038
const PAPER_W = MAP_W + MARGIN * 2
const PAPER_H = MAP_H + MARGIN * 2

/** lat/lon → paper-local metres (x east, z south; paper centred on 0). */
function geo(lat, lon) {
  return {
    x: ((lon - LON0) / (LON1 - LON0)) * MAP_W - MAP_W / 2,
    z: ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_H - MAP_H / 2,
  }
}

// Coastline, south-west to north-east, Zeeland's estuaries traced in and out
const COAST_FR = [
  [49.6, 0.6], [49.93, 1.08], [50.06, 1.38], [50.18, 1.53], [50.21, 1.63], [50.25, 1.6], [50.29, 1.55], [50.4, 1.56],
  [50.52, 1.58], [50.62, 1.57], [50.73, 1.59], [50.87, 1.58], [50.93, 1.7], [50.96, 1.85], [50.99, 2.1], [51.04, 2.37], [51.09, 2.55],
]
const COAST_BE = [[51.09, 2.55], [51.15, 2.72], [51.23, 2.92], [51.28, 3.05], [51.33, 3.2], [51.35, 3.29], [51.37, 3.37]]
const COAST_NL = [
  [51.37, 3.37], [51.4, 3.52],
  // Westerschelde, in along the south bank and out along the north
  [51.4, 3.57], [51.37, 3.66], [51.36, 3.78], [51.36, 3.9], [51.38, 4.0], [51.37, 4.1], [51.35, 4.2], [51.29, 4.27],
  [51.3, 4.3], [51.35, 4.26], [51.38, 4.21], [51.41, 4.12], [51.43, 4.02], [51.42, 3.92], [51.44, 3.82], [51.43, 3.72], [51.44, 3.62], [51.45, 3.57],
  // Walcheren
  [51.47, 3.5], [51.53, 3.44], [51.57, 3.5], [51.6, 3.62],
  // Oosterschelde
  [51.6, 3.7], [51.58, 3.8], [51.56, 3.92], [51.55, 4.03], [51.5, 4.08], [51.45, 4.15], [51.47, 4.2],
  [51.53, 4.13], [51.58, 4.08], [51.62, 4.0], [51.64, 3.9], [51.65, 3.8], [51.66, 3.72],
  // Schouwen, Grevelingen, Goeree
  [51.71, 3.72], [51.74, 3.8], [51.75, 3.86],
  [51.74, 3.9], [51.72, 3.97], [51.7, 4.05], [51.68, 4.15], [51.71, 4.15], [51.74, 4.07], [51.76, 3.97], [51.77, 3.88],
  [51.81, 3.87], [51.84, 3.95], [51.855, 4.02],
  // Haringvliet and Hollands Diep
  [51.84, 4.06], [51.82, 4.12], [51.78, 4.27], [51.74, 4.38], [51.7, 4.5], [51.69, 4.64],
  [51.71, 4.65], [51.72, 4.52], [51.76, 4.42], [51.81, 4.3], [51.85, 4.15], [51.865, 4.06],
  // Voorne, the Maasvlakte, Holland's straight dune coast
  [51.9, 4.04], [51.94, 3.99], [51.97, 3.98], [51.99, 4.05], [51.99, 4.12], [52.05, 4.18], [52.11, 4.27], [52.17, 4.35],
  [52.21, 4.4], [52.25, 4.43], [52.37, 4.52], [52.47, 4.57], [52.62, 4.62], [52.73, 4.64], [52.8, 4.66], [52.88, 4.7], [52.96, 4.75],
  // Den Helder, the Afsluitdijk, Friesland and Groningen
  [52.94, 4.85], [52.935, 5.04], [53.0, 5.17], [53.06, 5.3], [53.09, 5.36], [53.17, 5.4], [53.25, 5.48], [53.33, 5.6], [53.39, 5.8],
  [53.4, 5.95], [53.41, 6.1], [53.41, 6.2], [53.42, 6.35], [53.44, 6.55], [53.46, 6.78], [53.4, 6.9], [53.33, 6.93], [53.27, 7.0], [53.23, 7.12],
]
const COAST_DE = [[53.24, 7.2], [53.27, 7.27], [53.35, 7.21], [53.34, 7.05], [53.42, 7.03], [53.5, 7.08], [53.6, 7.12], [53.66, 7.3], [53.7, 7.7]]
const COAST = [...COAST_FR, ...COAST_BE.slice(1), ...COAST_NL.slice(1), ...COAST_DE]
const SEA = [...COAST, [54.2, 7.8], [54.2, 0.5], [49.6, 0.5]]

const ISLANDS = [
  // Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog, Rottumeroog, Borkum, Juist
  [[52.99, 4.72], [53.05, 4.71], [53.12, 4.76], [53.18, 4.86], [53.17, 4.9], [53.1, 4.88], [53.03, 4.83], [52.99, 4.78]],
  [[53.22, 4.93], [53.27, 5.0], [53.3, 5.1], [53.28, 5.12], [53.24, 5.02]],
  [[53.36, 5.18], [53.4, 5.3], [53.43, 5.45], [53.45, 5.57], [53.43, 5.58], [53.39, 5.45], [53.36, 5.3], [53.35, 5.2]],
  [[53.44, 5.62], [53.46, 5.75], [53.47, 5.9], [53.45, 5.92], [53.43, 5.8], [53.43, 5.65]],
  [[53.47, 6.12], [53.49, 6.2], [53.49, 6.32], [53.47, 6.33], [53.46, 6.2]],
  [[53.53, 6.55], [53.54, 6.6], [53.53, 6.62], [53.52, 6.57]],
  [[53.56, 6.65], [53.6, 6.68], [53.61, 6.76], [53.58, 6.78], [53.55, 6.72]],
  [[53.66, 6.95], [53.68, 7.05], [53.67, 7.1], [53.65, 7.0]],
]
const KENT = [[50.9, 0.6], [51.0, 0.98], [51.08, 1.17], [51.13, 1.33], [51.15, 1.38], [51.22, 1.4], [51.31, 1.43], [51.36, 1.44], [51.39, 1.38], [51.38, 1.2], [51.45, 0.9], [51.5, 0.6]]
// IJsselmeer and Markermeer as one water, the dikes drawn back over it
const IJSSELMEER = [
  [52.935, 5.04], [52.85, 5.09], [52.77, 5.11], [52.72, 5.22], [52.7, 5.29], [52.68, 5.22], [52.64, 5.07], [52.58, 5.08], [52.51, 5.06],
  [52.47, 5.08], [52.42, 5.02], [52.38, 4.98], [52.37, 5.05], [52.33, 5.07], [52.34, 5.13], [52.36, 5.2], [52.42, 5.3], [52.51, 5.42],
  [52.56, 5.45], [52.62, 5.53], [52.66, 5.6], [52.72, 5.65], [52.8, 5.7], [52.84, 5.7], [52.85, 5.55], [52.88, 5.36], [52.94, 5.4],
  [52.98, 5.42], [53.05, 5.39], [53.09, 5.36], [53.03, 5.22], [52.97, 5.1],
]
const DIKES = [
  [[52.935, 5.04], [53.0, 5.17], [53.06, 5.3], [53.09, 5.36]],
  [[52.7, 5.29], [52.53, 5.44]],
]
const RANDMEREN = [[52.33, 5.07], [52.3, 5.22], [52.27, 5.37], [52.25, 5.48], [52.31, 5.58], [52.37, 5.65], [52.45, 5.8], [52.52, 5.86], [52.56, 5.88], [52.6, 5.8], [52.62, 5.75]]

// Borders, each from one end to the other
const B_FR_BE = [
  [51.09, 2.55], [51.0, 2.6], [50.9, 2.63], [50.82, 2.8], [50.78, 2.95], [50.72, 3.1], [50.78, 3.22], [50.7, 3.3], [50.53, 3.28], [50.48, 3.6],
  [50.4, 3.67], [50.35, 3.8], [50.33, 4.05], [50.25, 4.15], [50.12, 4.2], [49.98, 4.17], [49.96, 4.45], [50.05, 4.68], [50.15, 4.83],
  [50.1, 4.87], [49.95, 4.95], [49.8, 5.1], [49.7, 5.3], [49.62, 5.45], [49.55, 5.82],
]
const B_BE_LU = [[49.55, 5.82], [49.65, 5.88], [49.75, 5.8], [49.85, 5.75], [49.97, 5.9], [50.05, 6.02], [50.13, 6.12]]
const B_BE_DE = [[50.13, 6.12], [50.25, 6.25], [50.33, 6.4], [50.45, 6.33], [50.55, 6.25], [50.63, 6.03], [50.7, 6.03], [50.75, 6.02]]
const B_BE_NL = [
  [50.75, 6.02], [50.76, 5.85], [50.75, 5.68], [50.8, 5.64], [50.9, 5.75], [51.0, 5.77], [51.1, 5.83], [51.15, 5.85], [51.17, 5.55],
  [51.22, 5.47], [51.27, 5.24], [51.32, 5.1], [51.42, 5.02], [51.45, 4.93], [51.43, 4.8], [51.49, 4.63], [51.47, 4.53], [51.43, 4.42],
  [51.36, 4.4], [51.35, 4.24], [51.27, 4.08], [51.25, 4.0], [51.21, 3.8], [51.2, 3.6], [51.27, 3.5], [51.31, 3.38], [51.37, 3.37],
]
const B_NL_DE = [
  [50.75, 6.02], [50.85, 6.07], [50.98, 5.92], [51.05, 6.05], [51.1, 6.17], [51.2, 6.08], [51.27, 6.22], [51.37, 6.23], [51.5, 6.2],
  [51.6, 6.1], [51.73, 5.95], [51.83, 5.97], [51.87, 6.1], [51.83, 6.38], [51.88, 6.7], [51.97, 6.8], [52.07, 6.7], [52.17, 7.05],
  [52.25, 7.03], [52.4, 7.02], [52.48, 6.7], [52.62, 6.75], [52.65, 7.05], [52.85, 7.08], [53.0, 7.2], [53.24, 7.2],
]
const B_FR_LU = [[49.55, 5.82], [49.5, 6.0], [49.45, 6.15], [49.47, 6.37]]
const B_LU_DE = [[50.13, 6.12], [50.0, 6.15], [49.88, 6.35], [49.8, 6.52], [49.7, 6.5], [49.6, 6.37], [49.47, 6.37]]
const B_FR_DE = [[49.47, 6.37], [49.4, 6.55], [49.2, 6.75], [49.15, 7.0], [49.1, 7.1], [49.15, 7.45], [49.05, 7.8]]
const BORDERS = [B_FR_BE, B_BE_LU, B_BE_DE, B_BE_NL, B_NL_DE, B_FR_LU, B_LU_DE, B_FR_DE]

const rev = (a) => [...a].reverse()
const COUNTRIES = [
  // hand-tinted like an old atlas: a pale wash and a deeper ribbon inside each border
  { color: [226, 170, 92], poly: [...COAST_NL, ...rev(B_NL_DE), ...B_BE_NL.slice(1)] },
  { color: [214, 128, 118], poly: [...COAST_BE, ...rev(B_BE_NL), ...rev(B_BE_DE), ...rev(B_BE_LU), ...rev(B_FR_BE)] },
  { color: [222, 190, 80], poly: [...B_BE_LU, ...B_LU_DE, ...rev(B_FR_LU)] },
  { color: [138, 158, 104], poly: [...COAST_FR, ...B_FR_BE, ...B_FR_LU.slice(1), ...B_FR_DE.slice(1), [48.0, 7.9], [48.0, 0.5], [49.6, 0.5]] },
  { color: [150, 132, 176], poly: [...COAST_DE, [53.7, 7.9], [49.05, 7.9], ...rev(B_FR_DE), ...rev(B_LU_DE).slice(1), ...B_BE_DE.slice(1), ...B_NL_DE.slice(1)] },
  { color: [170, 150, 120], poly: KENT },
]

const RIVERS = [
  // [width class, points]
  [3, [[50.35, 7.45], [50.45, 7.4], [50.58, 7.22], [50.73, 7.11], [50.85, 7.0], [50.94, 6.96], [51.05, 6.88], [51.18, 6.78], [51.25, 6.75], [51.35, 6.72], [51.45, 6.73], [51.55, 6.67], [51.66, 6.6], [51.75, 6.45], [51.82, 6.28], [51.84, 6.13], [51.86, 6.05]]],
  [3, [[51.86, 6.05], [51.85, 5.92], [51.85, 5.86], [51.88, 5.7], [51.88, 5.55], [51.89, 5.43], [51.84, 5.3], [51.81, 5.2], [51.82, 5.05], [51.83, 4.95], [51.82, 4.8], [51.81, 4.67], [51.86, 4.58], [51.9, 4.5], [51.9, 4.4], [51.92, 4.3], [51.95, 4.2], [51.98, 4.12]]],
  [2, [[51.86, 6.05], [51.92, 6.0], [51.97, 5.92], [51.97, 5.8], [51.96, 5.66], [51.97, 5.45], [51.97, 5.34], [51.98, 5.1], [51.96, 4.95], [51.95, 4.85], [51.91, 4.7], [51.9, 4.55]]],
  [2, [[51.96, 6.02], [52.03, 6.12], [52.14, 6.2], [52.25, 6.16], [52.35, 6.1], [52.45, 6.05], [52.52, 5.95], [52.56, 5.88]]],
  [3, [[48.5, 5.58], [48.85, 5.5], [49.16, 5.38], [49.4, 5.15], [49.55, 5.05], [49.7, 4.93], [49.77, 4.72], [49.9, 4.73], [50.05, 4.83], [50.14, 4.82], [50.26, 4.91], [50.4, 4.88], [50.47, 4.87], [50.52, 5.05], [50.52, 5.24], [50.58, 5.42], [50.63, 5.57], [50.72, 5.65], [50.85, 5.69], [51.0, 5.78], [51.1, 5.86], [51.19, 5.98], [51.3, 6.1], [51.37, 6.17], [51.48, 6.15], [51.6, 6.05], [51.7, 5.97], [51.76, 5.8], [51.77, 5.7], [51.76, 5.53], [51.75, 5.4], [51.73, 5.3], [51.73, 5.14], [51.72, 5.0], [51.71, 4.85], [51.7, 4.66]]],
  [1, [[50.2, 3.75], [50.28, 3.97], [50.35, 4.2], [50.41, 4.44], [50.45, 4.65], [50.47, 4.87]]],
  [2, [[49.98, 3.25], [50.17, 3.23], [50.36, 3.52], [50.45, 3.47], [50.6, 3.39], [50.75, 3.52], [50.85, 3.6], [50.95, 3.65], [51.05, 3.72], [51.04, 3.9], [51.03, 4.1], [51.1, 4.25], [51.22, 4.4], [51.29, 4.28]]],
  [1, [[50.65, 2.6], [50.7, 2.9], [50.8, 3.15], [50.83, 3.26], [50.95, 3.5], [51.05, 3.72]]],
  [3, [[48.4, 2.95], [48.54, 2.66], [48.61, 2.48], [48.73, 2.42], [48.82, 2.39], [48.86, 2.34], [48.85, 2.28], [48.83, 2.26], [48.86, 2.22], [48.9, 2.25], [48.93, 2.3], [48.95, 2.24], [48.9, 2.16], [48.95, 2.08], [49.0, 2.07], [48.99, 1.95], [48.99, 1.71], [49.08, 1.55], [49.2, 1.35], [49.25, 1.1]]],
  [2, [[48.96, 4.36], [49.04, 3.95], [49.05, 3.4], [48.96, 3.1], [48.96, 2.88], [48.88, 2.68], [48.82, 2.41]]],
  [2, [[49.9, 4.0], [49.8, 3.6], [49.6, 3.3], [49.42, 2.83], [49.3, 2.55], [49.26, 2.47], [49.15, 2.25], [49.05, 2.1], [48.99, 2.07]]],
  [1, [[49.4, 4.2], [49.38, 3.5], [49.42, 2.83]]],
  [2, [[49.85, 3.29], [49.93, 2.94], [49.9, 2.6], [49.89, 2.3], [49.97, 2.05], [50.1, 1.83], [50.21, 1.62]]],
  [2, [[48.6, 6.15], [49.12, 6.18], [49.37, 6.3], [49.5, 6.36], [49.7, 6.5], [49.75, 6.64], [49.95, 6.95], [50.1, 7.15], [50.25, 7.4], [50.35, 7.6]]],
  [1, [[49.24, 7.0], [49.4, 6.75], [49.6, 6.55]]],
  [1, [[52.6, 7.35], [53.0, 7.3], [53.2, 7.25], [53.27, 7.27]]],
]

const RAILWAYS = [
  [[48.88, 2.36], [49.26, 2.47], [49.86, 2.85], [50.64, 3.07], [50.6, 3.39], [50.85, 4.35]],
  [[50.85, 4.35], [51.03, 4.48], [51.22, 4.4], [51.53, 4.46], [51.81, 4.67], [51.92, 4.48], [52.01, 4.36], [52.08, 4.3], [52.16, 4.49], [52.38, 4.64], [52.37, 4.9]],
  [[52.37, 4.9], [52.09, 5.12], [51.69, 5.3], [51.44, 5.47], [51.25, 5.7], [51.19, 5.98], [51.0, 5.87], [50.85, 5.69]],
  [[50.85, 4.35], [50.88, 4.7], [50.63, 5.57], [50.78, 6.08], [50.94, 6.96]],
  [[52.09, 5.12], [51.98, 5.91], [51.83, 6.25], [51.43, 6.76], [51.23, 6.78], [50.94, 6.96]],
  [[52.37, 4.9], [52.16, 5.39], [52.51, 6.09], [53.22, 6.57]],
  [[52.51, 6.09], [53.2, 5.8]],
  [[50.64, 3.07], [50.95, 1.86], [51.05, 1.45]],
  [[51.92, 4.48], [51.59, 4.78], [51.56, 5.09], [51.44, 5.47]],
  [[48.88, 2.36], [49.26, 4.03], [49.77, 4.72]],
]

// [name, lat, lon, rank (1 capital · 2 city · 3 town), label side]
const CITIES = [
  ['Amsterdam', 52.37, 4.9, 1, 'r'], ['Rotterdam', 51.92, 4.48, 2, 'r'], ['Den Haag', 52.08, 4.3, 2, 'l'], ['Utrecht', 52.09, 5.12, 2, 'r'],
  ['Eindhoven', 51.44, 5.47, 2, 'r'], ['Groningen', 53.22, 6.57, 2, 'r'], ['Haarlem', 52.38, 4.64, 3, 'l'], ['Leiden', 52.16, 4.49, 3, 'r'],
  ['Delft', 52.01, 4.36, 3, 'r'], ['Dordrecht', 51.81, 4.67, 3, 'r'], ['Breda', 51.59, 4.78, 3, 'b'], ['Tilburg', 51.56, 5.09, 3, 'b'],
  ["'s-Hertogenbosch", 51.69, 5.3, 3, 'r'], ['Arnhem', 51.98, 5.91, 3, 'r'], ['Nijmegen', 51.84, 5.86, 3, 'r'], ['Zwolle', 52.51, 6.09, 3, 'r'],
  ['Leeuwarden', 53.2, 5.8, 3, 'r'], ['Enschede', 52.22, 6.89, 3, 'r'], ['Maastricht', 50.85, 5.69, 3, 'l'], ['Middelburg', 51.5, 3.61, 3, 'r'],
  ['Den Helder', 52.96, 4.76, 3, 'r'], ['Alkmaar', 52.63, 4.75, 3, 'r'], ['Amersfoort', 52.16, 5.39, 3, 'r'], ['Lelystad', 52.52, 5.47, 3, 'r'],
  ['Assen', 52.99, 6.56, 3, 'r'], ['Venlo', 51.37, 6.17, 3, 'l'],
  ['Bruxelles', 50.85, 4.35, 1, 'l'], ['Antwerpen', 51.22, 4.4, 2, 'r'], ['Gent', 51.05, 3.72, 2, 'r'], ['Brugge', 51.21, 3.22, 3, 'b'],
  ['Oostende', 51.23, 2.92, 3, 'l'], ['Liège', 50.63, 5.57, 2, 'r'], ['Namur', 50.47, 4.87, 3, 'r'], ['Charleroi', 50.41, 4.44, 3, 'l'],
  ['Leuven', 50.88, 4.7, 3, 'r'], ['Mechelen', 51.03, 4.48, 3, 'r'], ['Hasselt', 50.93, 5.34, 3, 'r'], ['Mons', 50.45, 3.95, 3, 'l'],
  ['Kortrijk', 50.83, 3.26, 3, 'l'],
  ['Paris', 48.86, 2.35, 1, 'r'], ['Lille', 50.63, 3.06, 2, 'r'], ['Amiens', 49.89, 2.3, 3, 'r'], ['Reims', 49.26, 4.03, 2, 'r'],
  ['Calais', 50.95, 1.86, 3, 'r'], ['Dunkerque', 51.03, 2.37, 3, 'r'], ['Boulogne', 50.73, 1.61, 3, 'r'], ['Arras', 50.29, 2.78, 3, 'r'],
  ['Saint-Quentin', 49.85, 3.29, 3, 'r'], ['Beauvais', 49.43, 2.08, 3, 'l'], ['Compiègne', 49.42, 2.83, 3, 'r'], ['Laon', 49.56, 3.62, 3, 'r'],
  ['Charleville', 49.77, 4.72, 3, 'r'], ['Valenciennes', 50.36, 3.52, 3, 'r'], ['Metz', 49.12, 6.18, 2, 'r'], ['Verdun', 49.16, 5.38, 3, 'r'],
  ['Luxembourg', 49.61, 6.13, 1, 'r'],
  ['Köln', 50.94, 6.96, 2, 'r'], ['Düsseldorf', 51.23, 6.78, 2, 'r'], ['Aachen', 50.78, 6.08, 3, 'r'], ['Duisburg', 51.43, 6.76, 3, 'r'],
  ['Bonn', 50.73, 7.1, 3, 'r'], ['Trier', 49.75, 6.64, 3, 'r'], ['Emden', 53.37, 7.21, 3, 'l'], ['Dover', 51.13, 1.31, 3, 'r'],
]

// more places a shoot might name (normalised), beyond the labelled towns
const PLACES_EXTRA = {
  'the hague': [52.08, 4.3], hague: [52.08, 4.3], 's gravenhage': [52.08, 4.3], scheveningen: [52.11, 4.27], kijkduin: [52.07, 4.22],
  brussels: [50.85, 4.35], brussel: [50.85, 4.35], antwerp: [51.22, 4.4], ghent: [51.05, 3.72], bruges: [51.21, 3.22], ostend: [51.23, 2.92],
  liege: [50.63, 5.57], luik: [50.63, 5.57], louvain: [50.88, 4.7], cologne: [50.94, 6.96], koln: [50.94, 6.96], koeln: [50.94, 6.96],
  dusseldorf: [51.23, 6.78], aken: [50.78, 6.08], luxemburg: [49.61, 6.13], parijs: [48.86, 2.35], rijsel: [50.63, 3.06],
  dunkirk: [51.03, 2.37], duinkerke: [51.03, 2.37], noordwijk: [52.24, 4.43], zandvoort: [52.37, 4.53], katwijk: [52.2, 4.4],
  wassenaar: [52.14, 4.4], amstelveen: [52.3, 4.86], zaandam: [52.44, 4.83], 'zaanse schans': [52.47, 4.82], volendam: [52.5, 5.07],
  marken: [52.46, 5.1], edam: [52.51, 5.05], giethoorn: [52.74, 6.08], kinderdijk: [51.88, 4.64], gouda: [52.01, 4.71], schiedam: [51.92, 4.4],
  lisse: [52.26, 4.56], keukenhof: [52.27, 4.55], texel: [53.08, 4.8], versailles: [48.8, 2.13], giverny: [49.08, 1.53],
  'bergen op zoom': [51.49, 4.29], roermond: [51.19, 5.99], heerlen: [50.89, 5.98], helmond: [51.48, 5.66], veldhoven: [51.42, 5.4],
  'den bosch': [51.69, 5.3], hertogenbosch: [51.69, 5.3], 's hertogenbosch': [51.69, 5.3], deventer: [52.25, 6.16], zutphen: [52.14, 6.2],
  apeldoorn: [52.21, 5.97], ede: [52.04, 5.67], wageningen: [51.97, 5.67], hilversum: [52.22, 5.18], almere: [52.37, 5.21], hoorn: [52.64, 5.06],
  enkhuizen: [52.7, 5.29], harlingen: [53.17, 5.42], vlissingen: [51.44, 3.57], domburg: [51.56, 3.5], knokke: [51.35, 3.29], 'de panne': [51.1, 2.59],
  dinant: [50.26, 4.91], durbuy: [50.35, 5.46], spa: [50.49, 5.86], essen: [51.46, 7.01], dunkerque: [51.03, 2.37],
  'tu e': [51.45, 5.49], tue: [51.45, 5.49], erasmus: [51.92, 4.53], trocadero: [48.86, 2.29],
  netherlands: [52.2, 5.3], nederland: [52.2, 5.3], holland: [52.3, 4.8], belgium: [50.65, 4.6], belgie: [50.65, 4.6], belgique: [50.65, 4.6],
  france: [48.86, 2.35], germany: [51.2, 6.9], deutschland: [51.2, 6.9],
}
// pleasant empty corners of the map for memories with no place
const FREE_SPOTS = [[52.95, 6.5], [53.07, 5.85], [52.3, 6.55], [51.58, 3.85], [50.15, 5.45], [49.6, 3.5], [52.72, 4.95], [51.25, 6.5], [49.3, 4.6], [51.0, 2.9], [50.0, 2.4], [52.0, 6.4]]

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

let PLACES = null
function lookupPlace(city) {
  if (!PLACES) {
    PLACES = {}
    for (const [name, la, lo] of CITIES) PLACES[norm(name)] = [la, lo]
    for (const [k, v] of Object.entries(PLACES_EXTRA)) PLACES[norm(k)] = v
  }
  const n = norm(city)
  if (!n) return null
  if (PLACES[n]) return PLACES[n]
  for (const part of String(city).split(/,|\/| - |·|\(|\)/)) {
    const p = norm(part)
    if (p && PLACES[p]) return PLACES[p]
  }
  let best = null
  for (const k of Object.keys(PLACES)) {
    if (k.length > 3 && (' ' + n + ' ').includes(' ' + k + ' ') && (!best || k.length > best.length)) best = k
  }
  return best ? PLACES[best] : null
}

const FALLBACK_MEMORIES = [
  { slug: 'evan-inez-paris', title: 'Evan & Inez', hero: '/photos/evan-inez-paris-08.jpg', city: 'Paris', lat: 48.862, lon: 2.288 },
  { slug: 'mieri-fathi', title: 'Mieri & Fathi', hero: '/photos/mieri-fathi-08.jpg', city: 'Kijkduin, The Hague', lat: 52.07, lon: 4.22 },
  { slug: 'kenneth-kusno', title: 'Kenneth Kusno', hero: '/photos/kenneth-kusno-04.jpg', city: 'Eindhoven', lat: 51.448, lon: 5.49 },
  { slug: 'keisha-lianto', title: 'Keisha Lianto', hero: '/photos/keisha-lianto-01.jpg', city: 'Rotterdam', lat: 51.909, lon: 4.487 },
]

/* --- painting ------------------------------------------------------------------ */

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif'
const HAND = '"Segoe Print", "Bradley Hand", "Snell Roundhand", "Apple Chancery", "URW Chancery L", "Z003", cursive'

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
function canvasTexture(THREE, c, { srgb = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = anisotropy
  t.needsUpdate = true
  return t
}

/** A small tile of paper fibre and grain, for multiplying over a sheet. */
function fibrePattern(g, seed = 3) {
  const n = 256
  const c = makeCanvas(n, n)
  const p = c.getContext('2d')
  const img = p.createImageData(n, n)
  const rand = seeded(seed)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 236 + rand() * 19
    img.data[i] = v
    img.data[i + 1] = v - 2
    img.data[i + 2] = v - 6
    img.data[i + 3] = 255
  }
  p.putImageData(img, 0, 0)
  p.lineCap = 'round'
  for (let i = 0; i < 260; i++) {
    const x = rand() * n
    const y = rand() * n
    const a = rand() * Math.PI
    const l = 3 + rand() * 9
    p.strokeStyle = rand() < 0.5 ? 'rgba(150,120,80,0.16)' : 'rgba(255,255,255,0.3)'
    p.lineWidth = 0.6
    p.beginPath()
    p.moveTo(x, y)
    p.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l)
    p.stroke()
  }
  return g.createPattern(c, 'repeat')
}

/** Letter-spaced text, centred on x. */
function spaced(g, text, x, y, spacing, halo) {
  const chars = [...text]
  const widths = chars.map((c) => g.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1)
  g.textAlign = 'left'
  for (const pass of halo ? ['halo', 'fill'] : ['fill']) {
    let cx = x - total / 2
    chars.forEach((c, i) => {
      if (pass === 'halo') g.strokeText(c, cx, y)
      else g.fillText(c, cx, y)
      cx += widths[i] + spacing
    })
  }
}

/**
 * The printed map, on a canvas W px wide: an engraved-atlas look — waterlined
 * coasts, hand-tinted borders, hachured hills, railways, towns, a cartouche.
 * Returns the canvas.
 */
function drawMap(W, memories) {
  const H = Math.round((W * PAPER_H) / PAPER_W)
  const c = makeCanvas(W, H)
  const g = c.getContext('2d')
  const ppm = W / PAPER_W
  const mm = (v) => (v * ppm) / 1000
  const P = (la, lo) => {
    const p = geo(la, lo)
    return [(p.x + PAPER_W / 2) * ppm, (p.z + PAPER_H / 2) * ppm]
  }
  const trace = (pts, close) => {
    pts.forEach(([la, lo], i) => {
      const [x, y] = P(la, lo)
      if (i) g.lineTo(x, y)
      else g.moveTo(x, y)
    })
    if (close) g.closePath()
  }
  // a smooth line through the points (rivers)
  const smoothTrace = (pts) => {
    const q = pts.map(([la, lo]) => P(la, lo))
    g.moveTo(q[0][0], q[0][1])
    for (let i = 1; i < q.length - 1; i++) {
      const mx = (q[i][0] + q[i + 1][0]) / 2
      const my = (q[i][1] + q[i + 1][1]) / 2
      g.quadraticCurveTo(q[i][0], q[i][1], mx, my)
    }
    g.lineTo(q[q.length - 1][0], q[q.length - 1][1])
  }
  const rand = seeded(17)
  const PAPER = '#efe4ca'
  const LAND = '#efe3c6'
  const SEA_COL = '#cfdcd4'
  const INK = '#2f2a25'
  const WATER_INK = '#43687a'
  const mx0 = MARGIN * ppm
  const my0 = MARGIN * ppm
  const mw = MAP_W * ppm
  const mh = MAP_H * ppm

  // the sheet
  g.fillStyle = PAPER
  g.fillRect(0, 0, W, H)

  g.save()
  g.beginPath()
  g.rect(mx0, my0, mw, mh)
  g.clip()

  // land and the tinted countries
  g.fillStyle = LAND
  g.fillRect(mx0, my0, mw, mh)
  g.lineJoin = 'round'
  g.lineCap = 'round'
  for (const k of COUNTRIES) {
    const [r, gg, b] = k.color
    g.save()
    g.beginPath()
    trace(k.poly, true)
    g.fillStyle = `rgba(${r},${gg},${b},0.16)`
    g.fill()
    g.clip()
    g.strokeStyle = `rgba(${r},${gg},${b},0.42)`
    g.lineWidth = mm(9)
    g.stroke()
    g.strokeStyle = `rgba(${r},${gg},${b},0.35)`
    g.lineWidth = mm(3.2)
    g.stroke()
    g.restore()
  }

  // hills: soft shading and hachures, darkest on the ridges
  const RELIEF = [
    [50.1, 5.65, 0.5, 0.95, 1], // Ardennes
    [50.35, 6.65, 0.32, 0.5, 0.9], // Eifel
    [49.9, 7.15, 0.22, 0.35, 0.8], // Hunsrück
    [50.55, 6.1, 0.12, 0.22, 0.7], // Hautes Fagnes
    [49.25, 4.9, 0.25, 0.4, 0.45], // Argonne
    [52.12, 5.85, 0.14, 0.22, 0.35], // Veluwe
    [50.6, 2.1, 0.15, 0.4, 0.35], // Artois
  ]
  for (const [la, lo, rla, rlo, k] of RELIEF) {
    const [cx, cy] = P(la, lo)
    const rx = (rlo / (LON1 - LON0)) * mw
    const ry = (rla / (LAT1 - LAT0)) * mh
    g.save()
    g.translate(cx, cy)
    g.scale(1, ry / rx)
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx)
    grd.addColorStop(0, `rgba(140,100,60,${0.16 * k})`)
    grd.addColorStop(1, 'rgba(140,100,60,0)')
    g.fillStyle = grd
    g.fillRect(-rx, -rx, rx * 2, rx * 2)
    g.restore()
    const n = Math.round(900 * k * (W / 2048) * (rx / 300))
    g.lineWidth = mm(0.22)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand())
      const x = cx + Math.cos(a) * rx * d
      const y = cy + Math.sin(a) * ry * d
      const l = mm(1.2 + 1.6 * (1 - d))
      const nx = Math.cos(a) + range(rand, -0.35, 0.35)
      const ny = Math.sin(a) * (ry / rx) + range(rand, -0.35, 0.35)
      const nl = Math.hypot(nx, ny) || 1
      g.strokeStyle = `rgba(110,78,48,${(0.18 + 0.3 * (1 - d)) * k})`
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + (nx / nl) * l, y + (ny / nl) * l)
      g.stroke()
    }
  }

  // the sea (islands as holes) and the lakes
  const seaPath = () => {
    g.beginPath()
    trace(SEA, true)
    for (const isl of ISLANDS) trace(isl, true)
    trace(KENT, true)
  }
  seaPath()
  g.fillStyle = SEA_COL
  g.fill('evenodd')
  g.beginPath()
  trace(IJSSELMEER, true)
  g.fill()

  // waterlining: fine lines following the shore, fading out to sea
  const waterlines = (clip, rule, shore, n, gap) => {
    g.save()
    clip()
    g.clip(rule)
    for (let k = n; k >= 1; k--) {
      g.beginPath()
      shore()
      g.lineWidth = 2 * k * gap
      g.strokeStyle = `rgba(67,104,122,${0.36 * Math.pow(1 - (k - 1) / n, 1.3)})`
      g.stroke()
      g.lineWidth = 2 * k * gap - mm(0.45)
      g.strokeStyle = SEA_COL
      g.stroke()
    }
    g.restore()
  }
  waterlines(seaPath, 'evenodd', () => {
    trace(COAST)
    for (const isl of ISLANDS) trace(isl, true)
    trace(KENT, true)
  }, 9, mm(1.55))
  waterlines(() => {
    g.beginPath()
    trace(IJSSELMEER, true)
  }, 'nonzero', () => trace(IJSSELMEER, true), 5, mm(1.3))
  // the Wadden flats: a faint sand stipple between the islands and the shore
  g.fillStyle = 'rgba(190,170,120,0.22)'
  for (let i = 0; i < 1600 * (W / 2048); i++) {
    const la = range(rand, 53.1, 53.5)
    const lo = range(rand, 4.85, 7.0)
    const coastLa = 53.17 + ((lo - 5.4) / 1.5) * 0.24
    if (la < coastLa + 0.02 || la > coastLa + 0.13) continue
    const [x, y] = P(la, lo)
    g.beginPath()
    g.arc(x, y, mm(0.35), 0, Math.PI * 2)
    g.fill()
  }

  // shorelines
  g.strokeStyle = 'rgba(52,78,90,0.9)'
  g.lineWidth = mm(0.55)
  g.beginPath()
  trace(COAST)
  for (const isl of ISLANDS) trace(isl, true)
  trace(KENT, true)
  trace(IJSSELMEER, true)
  g.stroke()
  // the dikes across the water
  for (const d of DIKES) {
    g.beginPath()
    trace(d)
    g.strokeStyle = 'rgba(52,78,90,0.9)'
    g.lineWidth = mm(1.9)
    g.stroke()
    g.strokeStyle = LAND
    g.lineWidth = mm(1.0)
    g.stroke()
  }
  // the border lakes of Flevoland
  g.beginPath()
  smoothTrace(RANDMEREN)
  g.strokeStyle = SEA_COL
  g.lineWidth = mm(1.8)
  g.stroke()
  g.strokeStyle = 'rgba(52,78,90,0.7)'
  g.lineWidth = mm(0.35)
  g.stroke()

  // rivers
  for (const [w, pts] of RIVERS) {
    g.beginPath()
    smoothTrace(pts)
    g.strokeStyle = 'rgba(70,112,136,0.95)'
    g.lineWidth = mm(0.35 + w * 0.32)
    g.stroke()
  }

  // graticule
  g.strokeStyle = 'rgba(120,92,62,0.32)'
  g.lineWidth = mm(0.25)
  g.beginPath()
  for (let lo = 2; lo <= 7; lo++) trace([[LAT0, lo], [LAT1, lo]])
  for (let la = 49; la <= 53; la++) trace([[la, LON0], [la, LON1]])
  g.stroke()

  // borders: dash-dot over the tint
  g.setLineDash([mm(2.6), mm(1.1), mm(0.5), mm(1.1)])
  g.strokeStyle = 'rgba(120,64,58,0.85)'
  g.lineWidth = mm(0.55)
  for (const b of BORDERS) {
    g.beginPath()
    trace(b)
    g.stroke()
  }
  g.setLineDash([])

  // railways: the old chequered line
  for (const r of RAILWAYS) {
    g.beginPath()
    trace(r)
    g.strokeStyle = 'rgba(40,34,30,0.8)'
    g.lineWidth = mm(0.95)
    g.stroke()
    g.setLineDash([mm(2.2), mm(2.2)])
    g.strokeStyle = 'rgba(244,236,214,0.95)'
    g.lineWidth = mm(0.42)
    g.stroke()
    g.setLineDash([])
  }

  // water names
  const water = (text, la, lo, size, rot = 0, spacing = 0.25) => {
    const [x, y] = P(la, lo)
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.font = `italic ${mm(size)}px ${SERIF}`
    g.fillStyle = WATER_INK
    g.textBaseline = 'middle'
    spaced(g, text, 0, 0, mm(size) * spacing, false)
    g.restore()
  }
  water('NOORDZEE', 52.32, 2.75, 9.5, 0, 0.55)
  water('Mer du Nord · North Sea', 52.19, 2.75, 5, 0, 0.12)
  water('Waddenzee', 53.27, 5.22, 4, -0.12, 0.1)
  water('IJsselmeer', 52.8, 5.38, 4.6, -0.2, 0.1)
  water('Markermeer', 52.55, 5.22, 3.2, -0.3, 0.06)
  water('Pas de Calais', 51.0, 1.52, 3.4, -1.0, 0.06)
  water('Westerschelde', 51.405, 3.83, 2.6, -0.05, 0.04)

  // country names, spaced capitals
  const country = (text, la, lo, size, rot = 0, spacing = 0.6) => {
    const [x, y] = P(la, lo)
    g.save()
    g.translate(x, y)
    g.rotate(rot)
    g.font = `${mm(size)}px ${SERIF}`
    g.fillStyle = 'rgba(92,62,44,0.62)'
    g.textBaseline = 'middle'
    spaced(g, text, 0, 0, mm(size) * spacing, false)
    g.restore()
  }
  country('FRANCE', 49.2, 3.25, 17, 0, 0.9)
  country('BELGIË · BELGIQUE', 50.2, 5.0, 8.5, -0.1, 0.5)
  country('NEDERLAND', 52.74, 6.25, 10, 0, 0.6)
  country('DEUTSCHLAND', 51.75, 7.3, 8, -Math.PI / 2, 0.55)
  country('LUX.', 49.85, 6.12, 4, 0, 0.4)
  country('ENGLAND', 51.27, 1.34, 3.2, -Math.PI / 2, 0.4)

  // towns: dots, then names with a paper halo
  const shot = new Set(memories.map((m) => m.labelCity).filter(Boolean))
  g.textBaseline = 'middle'
  for (const [name, la, lo, rank, side] of CITIES) {
    const [x, y] = P(la, lo)
    const r = rank === 1 ? mm(1.5) : rank === 2 ? mm(1.15) : mm(0.85)
    g.fillStyle = INK
    if (rank === 1) {
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.lineWidth = mm(0.45)
      g.strokeStyle = INK
      g.fillStyle = PAPER
      g.fill()
      g.stroke()
      g.beginPath()
      g.arc(x, y, r * 0.5, 0, Math.PI * 2)
      g.fillStyle = '#8a2a22'
      g.fill()
    } else {
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    const size = rank === 1 ? 6.4 : rank === 2 ? 5.1 : 4.0
    const bold = shot.has(name)
    g.font = `${rank === 1 || bold ? '600 ' : ''}${mm(size)}px ${SERIF}`
    const off = r + mm(1.4)
    let tx = x
    let ty = y
    if (side === 'r') {
      g.textAlign = 'left'
      tx = x + off
    } else if (side === 'l') {
      g.textAlign = 'right'
      tx = x - off
    } else {
      g.textAlign = 'center'
      ty = side === 't' ? y - off - mm(size) * 0.4 : y + off + mm(size) * 0.45
    }
    const label = rank === 1 ? name.toUpperCase() : name
    g.lineWidth = mm(1.1)
    g.strokeStyle = 'rgba(240,230,205,0.85)'
    g.strokeText(label, tx, ty)
    g.fillStyle = INK
    g.fillText(label, tx, ty)
  }

  // the title cartouche, out at sea
  {
    const [x0, y0] = P(53.52, 1.52)
    const [x1, y1] = P(52.86, 3.86)
    const w = x1 - x0
    const h = y1 - y0
    g.fillStyle = 'rgba(243,234,212,0.97)'
    g.fillRect(x0, y0, w, h)
    g.strokeStyle = INK
    g.lineWidth = mm(0.9)
    g.strokeRect(x0 + mm(1.2), y0 + mm(1.2), w - mm(2.4), h - mm(2.4))
    g.lineWidth = mm(0.3)
    g.strokeRect(x0 + mm(2.6), y0 + mm(2.6), w - mm(5.2), h - mm(5.2))
    // corner rosettes
    for (const [cx, cy] of [[x0 + mm(2.6), y0 + mm(2.6)], [x1 - mm(2.6), y0 + mm(2.6)], [x0 + mm(2.6), y1 - mm(2.6)], [x1 - mm(2.6), y1 - mm(2.6)]]) {
      g.beginPath()
      g.arc(cx, cy, mm(1.4), 0, Math.PI * 2)
      g.fillStyle = INK
      g.fill()
    }
    const cx = x0 + w / 2
    g.fillStyle = '#8a2a22'
    g.textBaseline = 'alphabetic'
    g.font = `${mm(14)}px ${SERIF}`
    spaced(g, 'MEMORIES', cx, y0 + h * 0.43, mm(4.2), false)
    g.strokeStyle = INK
    g.lineWidth = mm(0.3)
    g.beginPath()
    g.moveTo(cx - w * 0.3, y0 + h * 0.53)
    g.lineTo(cx - mm(3), y0 + h * 0.53)
    g.moveTo(cx + mm(3), y0 + h * 0.53)
    g.lineTo(cx + w * 0.3, y0 + h * 0.53)
    g.stroke()
    g.beginPath()
    g.moveTo(cx, y0 + h * 0.53 - mm(1.2))
    g.lineTo(cx + mm(1.2), y0 + h * 0.53)
    g.lineTo(cx, y0 + h * 0.53 + mm(1.2))
    g.lineTo(cx - mm(1.2), y0 + h * 0.53)
    g.closePath()
    g.fillStyle = INK
    g.fill()
    g.font = `italic ${mm(5.2)}px ${SERIF}`
    g.textAlign = 'center'
    g.fillText('the places we photographed', cx, y0 + h * 0.68)
    g.font = `${mm(3.4)}px ${SERIF}`
    spaced(g, 'LOSPIKIR · PHOTOGRAPHY', cx, y0 + h * 0.84, mm(1.1), false)
  }

  // compass rose
  {
    const [cx, cy] = P(51.78, 2.3)
    const R = mm(17)
    g.save()
    g.translate(cx, cy)
    g.strokeStyle = 'rgba(47,42,37,0.85)'
    g.lineWidth = mm(0.3)
    for (const rr of [R * 0.98, R * 0.9, R * 0.42]) {
      g.beginPath()
      g.arc(0, 0, rr, 0, Math.PI * 2)
      g.stroke()
    }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2
      g.beginPath()
      g.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9)
      g.lineTo(Math.cos(a) * R * (i % 4 ? 0.95 : 0.98), Math.sin(a) * R * (i % 4 ? 0.95 : 0.98))
      g.stroke()
    }
    const star = (len, wid, rot, dark, light) => {
      for (let i = 0; i < 4; i++) {
        const a = rot + (i * Math.PI) / 2
        const tip = [Math.sin(a) * len, -Math.cos(a) * len]
        const l = [Math.sin(a - Math.PI / 2) * wid, -Math.cos(a - Math.PI / 2) * wid]
        const r = [Math.sin(a + Math.PI / 2) * wid, -Math.cos(a + Math.PI / 2) * wid]
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(tip[0], tip[1])
        g.lineTo(l[0], l[1])
        g.closePath()
        g.fillStyle = dark
        g.fill()
        g.beginPath()
        g.moveTo(0, 0)
        g.lineTo(tip[0], tip[1])
        g.lineTo(r[0], r[1])
        g.closePath()
        g.fillStyle = light
        g.fill()
        g.stroke()
      }
    }
    star(R * 0.7, R * 0.12, Math.PI / 4, 'rgba(120,64,58,0.85)', 'rgba(243,234,212,0.95)')
    star(R * 1.0, R * 0.16, 0, 'rgba(47,42,37,0.9)', 'rgba(243,234,212,0.95)')
    g.font = `600 ${mm(5)}px ${SERIF}`
    g.fillStyle = INK
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.fillText('N', 0, -R * 1.08)
    g.restore()
  }
  g.restore() // map clip

  // the neatline: a graduated border in degrees and quarter degrees
  {
    const band = mm(2.4)
    g.strokeStyle = INK
    g.lineWidth = mm(0.35)
    g.strokeRect(mx0, my0, mw, mh)
    g.strokeRect(mx0 - band, my0 - band, mw + band * 2, mh + band * 2)
    g.lineWidth = mm(0.9)
    g.strokeRect(mx0 - band - mm(2), my0 - band - mm(2), mw + band * 2 + mm(4), mh + band * 2 + mm(4))
    g.fillStyle = INK
    let k = 0
    for (let lo = LON0; lo < LON1 - 1e-6; lo += 0.25, k++) {
      if (k % 2) continue
      const [xa] = P(LAT1, lo)
      const [xb] = P(LAT1, Math.min(LON1, lo + 0.25))
      g.fillRect(xa, my0 - band, xb - xa, band)
      g.fillRect(xa, my0 + mh, xb - xa, band)
    }
    k = 0
    for (let la = LAT0; la < LAT1 - 1e-6; la += 0.25, k++) {
      if (k % 2) continue
      const [, ya] = P(la, LON0)
      const [, yb] = P(Math.min(LAT1, la + 0.25), LON0)
      g.fillRect(mx0 - band, yb, band, ya - yb)
      g.fillRect(mx0 + mw, yb, band, ya - yb)
    }
    g.font = `${mm(3.2)}px ${SERIF}`
    g.fillStyle = INK
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (let lo = 2; lo <= 7; lo++) {
      const [x] = P(LAT1, lo)
      g.fillText(`${lo}°E`, x, my0 - band - mm(5.5))
      g.fillText(`${lo}°E`, x, my0 + mh + band + mm(5.5))
    }
    for (let la = 49; la <= 53; la++) {
      const [, y] = P(la, LON0)
      g.save()
      g.translate(mx0 - band - mm(5.5), y)
      g.rotate(-Math.PI / 2)
      g.fillText(`${la}°N`, 0, 0)
      g.restore()
      g.save()
      g.translate(mx0 + mw + band + mm(5.5), y)
      g.rotate(Math.PI / 2)
      g.fillText(`${la}°N`, 0, 0)
      g.restore()
    }
    // margin titles and a scale bar
    g.font = `${mm(4.2)}px ${SERIF}`
    g.textBaseline = 'alphabetic'
    spaced(g, 'THE NETHERLANDS · BELGIUM · THE NORTH OF FRANCE', W / 2, my0 - band - mm(11), mm(1.6), false)
    g.font = `italic ${mm(3.4)}px ${SERIF}`
    g.textAlign = 'left'
    g.fillText('Scale 1 : 600 000 — projection équirectangulaire', mx0, my0 + mh + band + mm(14))
    const kmPx = (mh / ((LAT1 - LAT0) * 111.2)) // px per km
    const sx = mx0 + mw - kmPx * 100
    const sy = my0 + mh + band + mm(12)
    g.lineWidth = mm(0.3)
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#f3ead6' : INK
      g.fillRect(sx + kmPx * 25 * i, sy, kmPx * 25, mm(1.6))
      g.strokeRect(sx + kmPx * 25 * i, sy, kmPx * 25, mm(1.6))
    }
    g.fillStyle = INK
    g.font = `${mm(3)}px ${SERIF}`
    g.textAlign = 'center'
    for (const km of [0, 50, 100]) g.fillText(String(km), sx + kmPx * km, sy - mm(1.4))
    g.textAlign = 'left'
    g.fillText('km', sx + kmPx * 100 + mm(2), sy + mm(1.6))
  }

  // the paper itself: fibre, folds, a little age
  g.save()
  g.globalCompositeOperation = 'multiply'
  g.fillStyle = fibrePattern(g, 5)
  g.fillRect(0, 0, W, H)
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56)
  vg.addColorStop(0, 'rgba(255,255,255,0)')
  vg.addColorStop(1, 'rgba(196,160,112,0.55)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 14; i++) {
    const x = rand() * W
    const y = rand() * H
    const r = mm(range(rand, 3, 18))
    const fg = g.createRadialGradient(x, y, 0, x, y, r)
    fg.addColorStop(0, `rgba(190,150,100,${range(rand, 0.08, 0.2)})`)
    fg.addColorStop(1, 'rgba(190,150,100,0)')
    g.fillStyle = fg
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  g.restore()
  // fold creases: rubbed light along the fold, a faint shadow beside it
  for (const f of FOLDS_X) {
    const x = (f.at + PAPER_W / 2) * ppm
    g.fillStyle = 'rgba(255,250,236,0.35)'
    g.fillRect(x - mm(0.5), 0, mm(1), H)
    g.fillStyle = 'rgba(110,84,50,0.10)'
    g.fillRect(x + mm(0.5), 0, mm(1.2), H)
  }
  for (const f of FOLDS_Z) {
    const y = (f.at + PAPER_H / 2) * ppm
    g.fillStyle = 'rgba(255,250,236,0.35)'
    g.fillRect(0, y - mm(0.5), W, mm(1))
    g.fillStyle = 'rgba(110,84,50,0.10)'
    g.fillRect(0, y + mm(0.5), W, mm(1.2))
  }
  return c
}

// a map that was folded into 3 × 4 panels and opened out again
const FOLDS_X = [
  { at: -PAPER_W / 6, s: 1 },
  { at: PAPER_W / 6, s: -1 },
]
const FOLDS_Z = [
  { at: -PAPER_H / 4, s: -1 },
  { at: 0, s: 1 },
  { at: PAPER_H / 4, s: -1 },
]
/** The sheet's height above the desk (paper-local metres). */
function paperHeight(x, z) {
  let h = 0.0016
  for (const f of FOLDS_X) h += f.s * 0.0011 * Math.exp(-(((x - f.at) / 0.02) ** 2))
  for (const f of FOLDS_Z) h += f.s * 0.0009 * Math.exp(-(((z - f.at) / 0.02) ** 2))
  h += 0.0005 * Math.sin(x * 9 + 1.3) * Math.sin(z * 7 + 0.4)
  // the corners curl up a little
  for (const [cx, cz, k] of [[-1, -1, 1], [1, -1, 0.6], [-1, 1, 0.8], [1, 1, 1.2]]) {
    const d = Math.hypot(x - (cx * PAPER_W) / 2, z - (cz * PAPER_H) / 2)
    const t = Math.max(0, 1 - d / 0.11)
    h += 0.007 * k * t * t
  }
  return Math.max(0.0003, h)
}

/* --- the photographs: exactly as shot ---------------------------------------- */

/*
 * The post chain maps everything through ACES (aces(c / 0.6)). A print should
 * look like the photograph, not like a lit surface, so its shader runs that
 * curve backwards: the colour that comes out on screen is the photo's own
 * (a touch below paper white, as a print is).
 */
function photoMaterial(THREE) {
  const inv = (arr) => new THREE.Matrix3().fromArray(arr).invert()
  const glsl = (m) => `mat3(${Array.from(m.elements).map((v) => v.toFixed(7)).join(',')})`
  const IN_INV = inv([0.59719, 0.076, 0.0284, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777])
  const OUT_INV = inv([1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602])
  const mat = new THREE.MeshBasicMaterial({ color: 0xe4dccd, toneMapped: false, fog: false })
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        vec3 untone(vec3 target) {
          vec3 y = clamp(${glsl(OUT_INV)} * (target * 0.9), 0.0, 0.86);
          vec3 a = 0.983729 * y - 1.0;
          vec3 b = 0.4329510 * y - 0.0245786;
          vec3 c = 0.238081 * y + 0.000090537;
          vec3 v = (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
          return max(${glsl(IN_INV)} * v, 0.0) * 0.6;
        }
        void main() {`
      )
      .replace('#include <opaque_fragment>', 'outgoingLight = untone(outgoingLight);\n#include <opaque_fragment>')
  }
  mat.customProgramCacheKey = () => 'memories-photo'
  return mat
}

/** Load a photo, crop it square (a little above centre) at a modest size. */
function loadPhoto(THREE, url, mat, size) {
  if (!url) return
  const loader = new THREE.ImageLoader()
  loader.setCrossOrigin('anonymous')
  loader.load(
    url,
    (img) => {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) return
      const side = Math.min(w, h)
      const sx = (w - side) / 2
      const sy = (h - side) * 0.4
      const c = makeCanvas(size, size)
      const g = c.getContext('2d')
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, sx, sy, side, side, 0, 0, size, size)
      const tex = canvasTexture(THREE, c)
      tex.generateMipmaps = true
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      mat.map = tex
      mat.color.set(0xffffff)
      mat.needsUpdate = true
    },
    undefined,
    () => {}
  )
}

/* --- the place ------------------------------------------------------------------ */

// instant print: a square photo in a white frame with a deep bottom strip
const FRAME_W = 0.064
const FRAME_H = 0.0778
const FRAME_T = 0.0012
const PHOTO = 0.0555
const PHOTO_TOP = 0.0045
const STAND_H = 0.0095
const SLOT = 0.003

export function buildMemoryMap(THREE, ctx = {}) {
  ctx.sky = null
  const low = ctx.quality === 'low'
  const rand = seeded(29)

  const world = createWorld(THREE, ctx, 'interior', {
    // late sun low through a window on the left, a little in front of the desk
    sun: { elevation: 14, azimuth: 290 },
    sky: { zenith: 0x7f9cc4, horizon: 0xf7c88e, ground: 0x4a3a2c, sun: 0xffd6a0, cloudLit: 0xffe2bc, cloudShade: 0xc99a86, clouds: 0.3 },
    sunColor: 0xffb878,
    sunIntensity: 5.6,
    hemi: [0xffe2c4, 0x3b2a1e, 0.55],
    exposure: 1.0,
  })
  const { scene } = world
  scene.environmentIntensity = 0.45
  const root = new THREE.Group()
  root.scale.setScalar(S)
  scene.add(root)
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  const W = (x, y, z) => new THREE.Vector3(x, y, z).multiplyScalar(S)

  /* the room ------------------------------------------------------------------ */
  const deskMat = M.planks(THREE, { color: '#4f2f1c', width: 0.32, gap: 0.0005, varnish: 1, tile: 2.4, quality: ctx.quality, seed: 41 })
  deskMat.roughness = 0.75
  const floorMat = M.planks(THREE, { color: '#6a4a31', width: 0.16, gap: 0.003, varnish: 1, tile: 2, quality: ctx.quality, seed: 43 })
  const wallMat = M.plaster(THREE, { color: '#c9b79c', dirt: 0.08, tile: 3, quality: ctx.quality, seed: 44 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe6ddcc, roughness: 0.55 })
  const box = (w, h, d, mat, x, y, z, tile = [1, 1], cast = true) => {
    const m = M.box(THREE, w, h, d, mat, tile)
    m.position.set(x, y, z)
    m.castShadow = cast
    root.add(m)
    return m
  }
  const FLOOR = -0.755
  const CEIL = 1.95
  const RH = CEIL - FLOOR
  // desk: a thick walnut top on square legs
  box(2.2, 0.045, 1.2, deskMat, 0, -0.045, 0, [2.4, 2.4])
  const legMat = deskMat
  for (const [x, z] of [[-1.03, -0.53], [1.03, -0.53], [-1.03, 0.53], [1.03, 0.53]]) box(0.07, 0.71, 0.07, legMat, x, FLOOR, z, [1.6, 1.6])
  box(2.0, 0.09, 1.0, legMat, 0, -0.135, 0, [1.6, 1.6])
  const floor = M.ground(THREE, 7, 7, floorMat, 2)
  floor.position.set(0.15, FLOOR, 0.35)
  root.add(floor)
  // left wall with the window (z −0.5 … 1.5, y −0.05 … 1.55 above the desk top)
  const WX = -1.55
  const WIN = { z0: -0.5, z1: 1.5, y0: -0.05, y1: 1.55 }
  const MULL = { z: [0.17, 0.83], y: 0.45, half: 0.024 }
  box(0.15, RH, 1.4, wallMat, WX - 0.075, FLOOR, -1.2, [3, 3])
  box(0.15, RH, 1.1, wallMat, WX - 0.075, FLOOR, 2.05, [3, 3])
  box(0.15, WIN.y0 - FLOOR, WIN.z1 - WIN.z0, wallMat, WX - 0.075, FLOOR, (WIN.z0 + WIN.z1) / 2, [3, 3])
  box(0.15, CEIL - WIN.y1, WIN.z1 - WIN.z0, wallMat, WX - 0.075, WIN.y1, (WIN.z0 + WIN.z1) / 2, [3, 3])
  for (const z of MULL.z) box(0.06, WIN.y1 - WIN.y0, MULL.half * 2, trimMat, WX - 0.03, WIN.y0, z)
  box(0.06, MULL.half * 2, WIN.z1 - WIN.z0, trimMat, WX - 0.03, MULL.y - MULL.half, (WIN.z0 + WIN.z1) / 2)
  box(0.08, 0.05, WIN.z1 - WIN.z0, trimMat, WX - 0.04, WIN.y1 - 0.05, (WIN.z0 + WIN.z1) / 2)
  for (const z of [WIN.z0 + 0.025, WIN.z1 - 0.025]) box(0.08, WIN.y1 - WIN.y0, 0.05, trimMat, WX - 0.04, WIN.y0, z)
  box(0.22, 0.03, WIN.z1 - WIN.z0 + 0.1, trimMat, WX + 0.04, WIN.y0 - 0.03, (WIN.z0 + WIN.z1) / 2)
  // the rest of the room (catches no sun, casts nothing)
  box(3.7, RH, 0.12, wallMat, 0.15, FLOOR, -1.96, [3, 3], false)
  box(0.12, RH, 4.7, wallMat, 2.06, FLOOR, 0.35, [3, 3], false)
  box(3.7, RH, 0.12, wallMat, 0.15, FLOOR, 2.66, [3, 3], false)
  box(3.8, 0.1, 4.7, wallMat, 0.15, CEIL, 0.35, [3, 3], false)
  // skirting
  box(3.6, 0.1, 0.02, trimMat, 0.15, FLOOR, -1.89, [1, 1], false)

  // a shelf of books on the back wall, far behind the map
  {
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.6 })
    const shelves = [0.42, 0.86]
    for (const y of shelves) box(1.5, 0.028, 0.22, shelfMat, 0.25, y, -1.79, [1, 1], false)
    const bookGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
    const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.7 })
    const COLS = [0x6e2420, 0x23344d, 0x2f4430, 0x9a7a3a, 0xd8ccb0, 0x1d1b1a, 0x5a3b2a, 0x7d6a55, 0x41506a]
    const books = new THREE.InstancedMesh(bookGeo, bookMat, 120)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    let n = 0
    for (const y of shelves) {
      let x = -0.46
      while (x < 0.96 && n < 120) {
        const w = range(rand, 0.018, 0.042)
        const h = range(rand, 0.17, 0.26)
        const d = range(rand, 0.13, 0.18)
        if (rand() < 0.06) {
          x += range(rand, 0.06, 0.14)
          continue
        }
        const lean = rand() < 0.08 ? range(rand, -0.12, 0.12) : 0
        q.setFromAxisAngle(V(0, 0, 1), lean)
        m4.compose(V(x + w / 2, y + 0.028, -1.8 + (0.18 - d) / 2), q, V(w, h, d))
        books.setMatrixAt(n, m4)
        col.setHex(COLS[Math.floor(rand() * COLS.length)]).offsetHSL(0, 0, range(rand, -0.04, 0.04))
        books.setColorAt(n, col)
        n++
        x += w + 0.002
      }
    }
    books.count = n
    books.instanceMatrix.needsUpdate = true
    if (books.instanceColor) books.instanceColor.needsUpdate = true
    books.receiveShadow = true
    root.add(books)
    // a framed print hanging between the shelf and the window
    const frame = box(0.42, 0.54, 0.025, shelfMat, -0.85, 0.6, -1.89, [1, 1], false)
    frame.receiveShadow = true
    const mount = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.48), new THREE.MeshStandardMaterial({ color: 0xe9e0cc, roughness: 0.9 }))
    mount.position.set(-0.85, 0.87, -1.864)
    root.add(mount)
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.32), new THREE.MeshStandardMaterial({ color: 0x2c2a28, roughness: 0.6 }))
    art.position.set(-0.85, 0.89, -1.863)
    root.add(art)
  }

  /* the map ----------------------------------------------------------------------- */
  const MAP_POS = V(-0.02, 0, 0.0)
  const MAP_YAW = 0.035
  const mapGroup = new THREE.Group()
  mapGroup.position.copy(MAP_POS)
  mapGroup.rotation.y = MAP_YAW
  root.add(mapGroup)

  // where every memory goes
  const input = Array.isArray(ctx.memories) && ctx.memories.length ? ctx.memories : FALLBACK_MEMORIES
  const memories = input.map((m, i) => {
    let la = Number.isFinite(m?.lat) ? m.lat : null
    let lo = Number.isFinite(m?.lon) ? m.lon : null
    let found = null
    if (la == null || lo == null) {
      found = lookupPlace(m?.city)
      if (found) [la, lo] = found
    }
    // the printed town this memory belongs to (bolded on the map)
    let labelCity = null
    if (la != null) {
      let best = 0.12
      for (const [name, cla, clo] of CITIES) {
        const d = Math.hypot(cla - la, (clo - lo) * 0.63)
        if (d < best) {
          best = d
          labelCity = name
        }
      }
    }
    return { ...m, index: i, lat: la, lon: lo, labelCity }
  })
  let freeK = 0
  for (const m of memories) {
    if (m.lat != null) continue
    // somewhere quiet that no other memory is near
    for (; freeK < FREE_SPOTS.length * 2; freeK++) {
      const [la, lo] = FREE_SPOTS[freeK % FREE_SPOTS.length]
      const busy = memories.some((o) => o !== m && o.lat != null && Math.hypot(o.lat - la, (o.lon - lo) * 0.63) < 0.25)
      if (!busy || freeK >= FREE_SPOTS.length) {
        m.lat = la + (freeK >= FREE_SPOTS.length ? 0.12 : 0)
        m.lon = lo
        freeK++
        break
      }
    }
    if (m.lat == null) {
      m.lat = 52.9 - 0.2 * m.index
      m.lon = 2.2
    }
  }
  for (const m of memories) {
    m.lat = Math.min(LAT1 - 0.15, Math.max(LAT0 + 0.15, m.lat))
    m.lon = Math.min(LON1 - 0.15, Math.max(LON0 + 0.12, m.lon))
    const p = geo(m.lat, m.lon)
    m.anchor = { x: p.x, z: p.z }
  }
  // several in one place fan out in front of it, then nothing may overlap
  const groups = new Map()
  for (const m of memories) {
    const key = `${Math.round(m.anchor.x / 0.004)},${Math.round(m.anchor.z / 0.004)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(m)
  }
  for (const list of groups.values()) {
    const n = list.length
    list.forEach((m, k) => {
      if (n === 1) {
        m.home = { x: m.anchor.x, z: m.anchor.z + 0.008 }
        return
      }
      const a = Math.PI * (0.12 + (0.76 * (k + 0.5)) / n)
      const r = 0.036 + 0.009 * n
      m.home = { x: m.anchor.x + Math.cos(a) * r * 1.15, z: m.anchor.z + Math.sin(a) * r * 0.85 }
    })
  }
  for (const m of memories) m.pos = { ...m.home }
  const MIN_D = 0.074
  const clampToMap = (p) => {
    p.x = Math.min(MAP_W / 2 - 0.035, Math.max(-MAP_W / 2 + 0.035, p.x))
    p.z = Math.min(MAP_H / 2 - 0.03, Math.max(-MAP_H / 2 + 0.03, p.z))
  }
  for (let it = 0; it < 60; it++) {
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i].pos
        const b = memories[j].pos
        let dx = b.x - a.x
        let dz = b.z - a.z
        let d = Math.hypot(dx, dz)
        if (d >= MIN_D) continue
        if (d < 1e-5) {
          dx = Math.cos(i + j)
          dz = Math.sin(i + j)
          d = 1
        }
        const push = ((MIN_D - d) / 2) * 0.8
        a.x -= (dx / d) * push
        a.z -= (dz / d) * push
        b.x += (dx / d) * push
        b.z += (dz / d) * push
      }
    }
    for (const m of memories) {
      m.pos.x += (m.home.x - m.pos.x) * 0.04
      m.pos.z += (m.home.z - m.pos.z) * 0.04
      clampToMap(m.pos)
    }
  }

  // the paper
  {
    const W0 = low ? 1024 : 2048
    const mapCanvas = drawMap(W0, memories)
    const tex = canvasTexture(THREE, mapCanvas, { anisotropy: 8 })
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    const fibre = noiseNormalMap(THREE, 256, { cells: 96, strength: 0.7, octaves: 2 })
    fibre.repeat.set(7, 9)
    const geom = new THREE.PlaneGeometry(PAPER_W, PAPER_H, low ? 60 : 120, low ? 78 : 156)
    geom.rotateX(-Math.PI / 2)
    const pos = geom.attributes.position
    for (let i = 0; i < pos.count; i++) pos.setY(i, paperHeight(pos.getX(i), pos.getZ(i)))
    geom.computeVertexNormals()
    const paper = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ map: tex, normalMap: fibre, normalScale: new THREE.Vector2(0.07, 0.07), roughness: 0.88, metalness: 0, side: THREE.DoubleSide })
    )
    paper.receiveShadow = true
    paper.castShadow = true
    mapGroup.add(paper)
  }

  /* the prints ---------------------------------------------------------------------- */
  const props = [
    // obstacles a viewpoint must keep clear of: desk coords, radius
    { x: 0.62, z: -0.42, r: 0.11 }, // lamp
    { x: -0.6, z: -0.33, r: 0.1 }, // coffee
    { x: 0.62, z: 0.3, r: 0.11 }, // camera
  ]
  const toPaper = (x, z) => {
    const dx = x - MAP_POS.x
    const dz = z - MAP_POS.z
    const c = Math.cos(MAP_YAW)
    const s = Math.sin(MAP_YAW)
    return { x: dx * c - dz * s, z: dx * s + dz * c }
  }
  const obstacles = props.map((p) => ({ ...toPaper(p.x, p.z), r: p.r }))
  const CAM_D = 0.2
  const CAM_Y = 0.082
  const segDist = (px, pz, ax, az, bx, bz) => {
    const vx = bx - ax
    const vz = bz - az
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)))
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
  }
  // choose, for each print, the direction it faces = where its viewpoint stands
  for (const m of memories) {
    const pref = (m.index % 2 ? 1 : -1) * 0.32 + range(rand, -0.06, 0.06)
    const tries = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6]
    let best = null
    for (const dt of tries) {
      const phi = pref + dt
      const cx = m.pos.x + Math.sin(phi) * CAM_D
      const cz = m.pos.z + Math.cos(phi) * CAM_D
      let ok = true
      for (const o of memories) {
        if (o === m) continue
        if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 0.1 || segDist(o.pos.x, o.pos.z, cx, cz, m.pos.x, m.pos.z) < 0.05) {
          ok = false
          break
        }
      }
      if (ok) for (const o of obstacles) if (Math.hypot(o.x - cx, o.z - cz) < o.r + 0.05 || segDist(o.x, o.z, cx, cz, m.pos.x, m.pos.z) < o.r) ok = false
      if (ok) {
        best = phi
        break
      }
    }
    m.lifted = best == null
    m.phi = best == null ? pref : best
    m.yaw = m.phi + range(rand, -0.07, 0.07)
  }

  const photoBase = photoMaterial(THREE)
  const bodyFront = new THREE.MeshStandardMaterial({ color: 0xf2efe7, roughness: 0.55 })
  const bodyBack = new THREE.MeshStandardMaterial({ color: 0x26272a, roughness: 0.6 })
  const bodyGeo = new THREE.BoxGeometry(FRAME_W, FRAME_H, FRAME_T)
  const faceGeo = new THREE.PlaneGeometry(FRAME_W, FRAME_H)
  const photoGeo = new THREE.PlaneGeometry(PHOTO, PHOTO)
  const gloss = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.14,
    metalness: 0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    envMapIntensity: 1.2,
  })
  const prints = []
  const photoMats = []
  const photoSize = low ? 384 : 640
  const standGeo = new RoundedBoxGeometry(0.04, STAND_H, 0.017, 2, 0.0025).translate(0, STAND_H / 2, 0)
  const standNormal = noiseNormalMap(THREE, 128, { cells: 16, strength: 2, octaves: 3, stretch: [1, 6] })
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8c5b33, roughness: 0.5, normalMap: standNormal, normalScale: new THREE.Vector2(0.4, 0.4) })
  const stands = new THREE.InstancedMesh(standGeo, standMat, memories.length)
  const pinHeads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.0034, 16, 12),
    new THREE.MeshPhysicalMaterial({ color: 0xb3161d, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 }),
    memories.length
  )
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = V(1, 1, 1)
  const pins = []
  memories.forEach((m, i) => {
    const base = paperHeight(m.pos.x, m.pos.z)
    q.setFromAxisAngle(V(0, 1, 0), m.yaw)
    m4.compose(V(m.pos.x, base, m.pos.z), q, one)
    stands.setMatrixAt(i, m4)
    // the print, pivoting on its bottom edge in the stand's slot
    const pivot = new THREE.Group()
    pivot.position.set(m.pos.x, base + STAND_H - SLOT, m.pos.z)
    pivot.rotation.order = 'YXZ'
    pivot.rotation.y = m.yaw
    pivot.rotation.x = -0.05
    const body = new THREE.Mesh(bodyGeo, [bodyFront, bodyFront, bodyFront, bodyFront, bodyFront, bodyBack])
    body.position.y = FRAME_H / 2
    body.castShadow = true
    body.receiveShadow = true
    pivot.add(body)
    const face = new THREE.Mesh(faceGeo, captionMaterial(THREE, m, i))
    face.position.set(0, FRAME_H / 2, FRAME_T / 2 + 0.00005)
    face.receiveShadow = true
    pivot.add(face)
    const pm = photoBase.clone()
    pm.onBeforeCompile = photoBase.onBeforeCompile
    pm.customProgramCacheKey = photoBase.customProgramCacheKey
    photoMats.push(pm)
    const photo = new THREE.Mesh(photoGeo, pm)
    photo.position.set(0, FRAME_H - PHOTO_TOP - PHOTO / 2, FRAME_T / 2 + 0.0001)
    pivot.add(photo)
    const sheen = new THREE.Mesh(photoGeo, gloss)
    sheen.position.copy(photo.position)
    sheen.position.z += 0.00008
    pivot.add(sheen)
    mapGroup.add(pivot)
    loadPhoto(THREE, m.hero, pm, photoSize)
    prints.push({ pivot, phase: rand() * Math.PI * 2, memory: m })
    // the thread's pin, in front of the stand
    const px = m.pos.x + Math.sin(m.yaw) * 0.016
    const pz = m.pos.z + Math.cos(m.yaw) * 0.016
    const ph = paperHeight(px, pz) + 0.0065
    m4.makeTranslation(px, ph, pz)
    pinHeads.setMatrixAt(i, m4)
    pins.push(V(px, ph, pz))
  })
  stands.instanceMatrix.needsUpdate = true
  pinHeads.instanceMatrix.needsUpdate = true
  stands.castShadow = stands.receiveShadow = true
  pinHeads.castShadow = true
  mapGroup.add(stands, pinHeads)
  {
    const needleGeo = new THREE.CylinderGeometry(0.0004, 0.0004, 0.007, 6).translate(0, -0.0035, 0)
    const needles = new THREE.InstancedMesh(needleGeo, new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 1, roughness: 0.3 }), pins.length)
    pins.forEach((p, i) => needles.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)))
    needles.instanceMatrix.needsUpdate = true
    mapGroup.add(needles)
  }
  // the red thread, pin to pin in story order, with a little slack
  if (pins.length > 1) {
    const parts = []
    for (let i = 0; i < pins.length - 1; i++) {
      const a = pins[i]
      const b = pins[i + 1]
      const len = a.distanceTo(b)
      const mid = a.clone().lerp(b, 0.5)
      mid.y = Math.max(paperHeight(mid.x, mid.z) + 0.0012, mid.y - 0.0015 - len * 0.006)
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
      parts.push(new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 120)), 0.00045, 5, false))
    }
    const thread = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xa3141b, roughness: 0.8 }))
    thread.castShadow = true
    mapGroup.add(thread)
    for (const p of parts) p.dispose()
  }

  /* the things on the desk ------------------------------------------------------------ */
  const brass = new THREE.MeshStandardMaterial({ color: 0xc39a4e, metalness: 1, roughness: 0.28 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 1, roughness: 0.2 })
  const blackGloss = new THREE.MeshPhysicalMaterial({ color: 0x111112, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 })
  const blackMatte = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75 })
  const lathe = (pts, mat, seg = 48) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat)
    m.castShadow = m.receiveShadow = true
    return m
  }
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    m.castShadow = m.receiveShadow = true
    parent.add(m)
    return m
  }

  // brass lamp, back right, leaning over the map
  const LAMP_B = V(0.62, 0, -0.42)
  const LAMP_H = V(0.4, 0.43, -0.26)
  const LAMP_T = V(0.06, 0, -0.02)
  const lampDir = LAMP_T.clone().sub(LAMP_H).normalize()
  let bulbMat
  {
    const lamp = new THREE.Group()
    root.add(lamp)
    const base = lathe([[0, 0], [0.085, 0], [0.088, 0.004], [0.086, 0.011], [0.07, 0.018], [0.03, 0.024], [0.016, 0.03], [0, 0.031]], brass)
    base.position.copy(LAMP_B)
    lamp.add(base)
    const elbow = LAMP_B.clone().setY(0.3)
    const rod = (a, b, r) => {
      const len = a.distanceTo(b)
      const m = mesh(new THREE.CylinderGeometry(r, r, len, 16), brass, lamp)
      m.position.copy(a).lerp(b, 0.5)
      m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
      return m
    }
    rod(LAMP_B.clone().setY(0.03), elbow, 0.0075)
    mesh(new THREE.SphereGeometry(0.013, 20, 14), brass, lamp, elbow.x, elbow.y, elbow.z)
    rod(elbow, LAMP_H, 0.0065)
    mesh(new THREE.SphereGeometry(0.011, 20, 14), brass, lamp, LAMP_H.x, LAMP_H.y, LAMP_H.z)
    const shade = new THREE.Group()
    shade.position.copy(LAMP_H)
    shade.quaternion.setFromUnitVectors(V(0, -1, 0), lampDir)
    lamp.add(shade)
    const prof = [[0.076, -0.125], [0.075, -0.118], [0.066, -0.092], [0.05, -0.058], [0.034, -0.028], [0.022, -0.01], [0.014, 0.0], [0, 0.004]]
    const outer = lathe(prof, brass, 56)
    shade.add(outer)
    const inner = lathe(prof.map(([r, y]) => [r * 0.97, y - 0.0015]), new THREE.MeshStandardMaterial({ color: 0xf2e6cf, roughness: 0.6, emissive: 0xffd2a0, emissiveIntensity: 0.9, side: THREE.BackSide }), 56)
    inner.castShadow = false
    shade.add(inner)
    bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b8).multiplyScalar(5) })
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 14), bulbMat)
    bulb.position.set(0, -0.05, 0)
    shade.add(bulb)
    // the light itself
    const spot = new THREE.SpotLight(0xffc489, 270, 0, 0.62, 0.75, 2)
    spot.position.copy(LAMP_H).addScaledVector(lampDir, 0.07)
    spot.target.position.copy(LAMP_T)
    spot.castShadow = true
    spot.shadow.mapSize.set(low ? 512 : 1024, low ? 512 : 1024)
    spot.shadow.camera.near = 0.6
    spot.shadow.camera.far = 40
    spot.shadow.bias = -0.0004
    spot.shadow.normalBias = 0.02
    spot.shadow.radius = 4
    root.add(spot, spot.target)
  }
  // a little bounce light from the room in front, so print faces aren't black
  {
    const fill = new THREE.PointLight(0xffd6ae, 300, 0, 2)
    fill.position.set(0.3, 0.9, 1.6)
    root.add(fill)
  }

  // coffee, back left in the sun
  const CUP = V(-0.6, 0, -0.33)
  let steamMat
  {
    const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xefe8dc, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.08 })
    const cup = new THREE.Group()
    cup.position.copy(CUP)
    cup.rotation.y = 0.6
    root.add(cup)
    cup.add(lathe([[0, 0], [0.05, 0], [0.058, 0.004], [0.075, 0.012], [0.078, 0.0145], [0.074, 0.0135], [0.056, 0.0075], [0.03, 0.0065], [0, 0.0068]], ceramic))
    cup.add(lathe([[0, 0.0065], [0.026, 0.0065], [0.028, 0.01], [0.034, 0.025], [0.04, 0.05], [0.043, 0.074], [0.0445, 0.0765], [0.041, 0.075], [0.038, 0.05], [0.032, 0.025], [0.024, 0.014], [0, 0.013]], ceramic))
    const handle = mesh(new THREE.TorusGeometry(0.017, 0.0048, 10, 24, Math.PI * 1.15), ceramic, cup, 0.04, 0.043, 0)
    handle.rotation.z = -Math.PI / 2 - 0.075 * Math.PI
    const crema = makeCanvas(128, 128)
    {
      const g = crema.getContext('2d')
      const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
      grd.addColorStop(0, '#3a1f10')
      grd.addColorStop(0.62, '#4a2a16')
      grd.addColorStop(0.86, '#8a5a32')
      grd.addColorStop(1, '#b07a4a')
      g.fillStyle = grd
      g.fillRect(0, 0, 128, 128)
    }
    const coffee = mesh(
      new THREE.CircleGeometry(0.0392, 40).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ map: canvasTexture(THREE, crema), roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
      cup,
      0,
      0.064,
      0
    )
    coffee.castShadow = false
    // steam
    steamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vec2(vUv.x * 2.2 + sin(vUv.y * 5.0 + uTime * 0.7) * 0.25, vUv.y * 2.4 - uTime * 0.22);
          float n = fbm(p * 1.6);
          float wisp = smoothstep(0.5, 0.78, n);
          float mask = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
          gl_FragColor = vec4(vec3(1.0, 0.92, 0.8) * wisp * mask * 0.09, 1.0);
        }`,
    })
    for (const r of [0, Math.PI / 2]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.15), steamMat)
      s.position.set(0, 0.078 + 0.075, 0)
      s.rotation.y = r
      cup.add(s)
    }
  }

  // open notebook, front left, and a fountain pen
  {
    const nb = new THREE.Group()
    nb.position.set(-0.61, 0, 0.27)
    nb.rotation.y = 0.2
    root.add(nb)
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.62, normalMap: noiseNormalMap(THREE, 128, { cells: 24, strength: 2, octaves: 3 }), normalScale: new THREE.Vector2(0.5, 0.5) })
    mesh(new THREE.BoxGeometry(0.298, 0.0035, 0.212).translate(0, 0.00175, 0), leather, nb)
    const pageSide = new THREE.MeshStandardMaterial({ color: 0xe9e0cc, roughness: 0.9 })
    for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.124, 0.0055, 0.2).translate(sx * (0.018 + 0.062), 0.0035 + 0.00275, 0), pageSide, nb)
    const spread = notebookTexture(THREE, memories)
    const pageMat = new THREE.MeshStandardMaterial({ map: spread, roughness: 0.88 })
    for (const sx of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.143, 0.204, 24, 1)
      geo.rotateX(-Math.PI / 2)
      const p = geo.attributes.position
      const uv = geo.attributes.uv
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i) + sx * 0.0715
        const d = Math.abs(lx)
        p.setX(i, lx)
        p.setY(i, 0.0106 - 0.0058 * Math.exp(-d / 0.011) - 0.0012 * (d / 0.143) ** 3)
        uv.setX(i, uv.getX(i) * 0.5 + (sx > 0 ? 0.5 : 0))
      }
      geo.computeVertexNormals()
      mesh(geo, pageMat, nb)
    }
    const pen = new THREE.Group()
    pen.position.set(0.075, 0.0152, 0.005)
    pen.rotation.y = 0.55
    nb.add(pen)
    const along = (geo) => geo.rotateZ(Math.PI / 2)
    mesh(along(new THREE.CylinderGeometry(0.0052, 0.0047, 0.1, 20)), blackGloss, pen, -0.005, 0, 0)
    mesh(along(new THREE.CylinderGeometry(0.0056, 0.0056, 0.055, 20)), blackGloss, pen, 0.07, 0, 0)
    mesh(along(new THREE.CylinderGeometry(0.0058, 0.0058, 0.004, 20)), brass, pen, 0.0425, 0, 0)
    mesh(new THREE.BoxGeometry(0.04, 0.0012, 0.0022), brass, pen, 0.075, 0.0058, 0)
    mesh(along(new THREE.CylinderGeometry(0.0006, 0.0042, 0.018, 16)), brass, pen, -0.064, 0, 0)
  }

  // spare prints, face down, and one face up
  {
    const stack = new THREE.Group()
    stack.position.set(-0.47, 0, 0.5)
    stack.rotation.y = -0.35
    root.add(stack)
    for (let k = 0; k < 3; k++) {
      const b = mesh(bodyGeo, [bodyFront, bodyFront, bodyFront, bodyFront, bodyFront, bodyBack], stack, k * 0.004, FRAME_T / 2 + k * FRAME_T, -k * 0.003)
      b.rotation.x = Math.PI / 2
      b.rotation.z = k * 0.12
    }
    const topMem = memories[memories.length - 1]
    const face = new THREE.Group()
    face.position.set(0.012, FRAME_T * 3.2, -0.008)
    face.rotation.set(-Math.PI / 2, 0, 0.32)
    stack.add(face)
    mesh(faceGeo, captionMaterial(THREE, topMem, memories.length - 1), face, 0, 0, 0)
    const ph = new THREE.Mesh(photoGeo, photoMats[photoMats.length - 1])
    ph.position.set(0, FRAME_H / 2 - PHOTO_TOP - PHOTO / 2, 0.0001)
    face.add(ph)
  }

  // the film camera, front right
  {
    const cam = new THREE.Group()
    cam.position.set(0.62, 0, 0.3)
    cam.rotation.y = -0.55
    root.add(cam)
    const leatherette = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.8, normalMap: noiseNormalMap(THREE, 128, { cells: 40, strength: 4, octaves: 2 }), normalScale: new THREE.Vector2(0.8, 0.8) })
    leatherette.normalMap.repeat.set(3, 2)
    mesh(new RoundedBoxGeometry(0.14, 0.062, 0.036, 3, 0.005), leatherette, cam, 0, 0.031, 0)
    mesh(new RoundedBoxGeometry(0.142, 0.017, 0.038, 3, 0.004), chrome, cam, 0, 0.069, 0)
    const prism = new THREE.Shape()
    prism.moveTo(-0.026, 0)
    prism.lineTo(0.026, 0)
    prism.lineTo(0.014, 0.025)
    prism.lineTo(-0.014, 0.025)
    prism.closePath()
    const pg = new THREE.ExtrudeGeometry(prism, { depth: 0.034, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 })
    pg.translate(0, 0, -0.017)
    mesh(pg, blackGloss, cam, 0, 0.0765, 0)
    const zc = (geo) => geo.rotateX(Math.PI / 2)
    mesh(zc(new THREE.CylinderGeometry(0.026, 0.026, 0.006, 40)), chrome, cam, 0, 0.034, 0.021)
    mesh(zc(new THREE.CylinderGeometry(0.0285, 0.0285, 0.038, 40)), blackMatte, cam, 0, 0.034, 0.043)
    const knurl = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.55, flatShading: true })
    mesh(zc(new THREE.CylinderGeometry(0.0302, 0.0302, 0.013, 72)), knurl, cam, 0, 0.034, 0.042)
    mesh(zc(new THREE.CylinderGeometry(0.0288, 0.0288, 0.004, 40)), chrome, cam, 0, 0.034, 0.059)
    mesh(zc(new THREE.CylinderGeometry(0.027, 0.0275, 0.008, 40)), blackMatte, cam, 0, 0.034, 0.065)
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1018, roughness: 0.03, metalness: 0.2, clearcoat: 1, iridescence: 0.9, iridescenceIOR: 1.7, iridescenceThicknessRange: [250, 500] })
    const lens = mesh(new THREE.SphereGeometry(0.03, 32, 12, 0, Math.PI * 2, 0, 0.75), glass, cam, 0, 0.034, 0.036)
    lens.rotation.x = Math.PI / 2
    lens.castShadow = false
    const dial = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 1, roughness: 0.3, flatShading: true })
    mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 28), dial, cam, 0.038, 0.0805, 0.002)
    mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 16), chrome, cam, 0.056, 0.0795, 0.009)
    mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.008, 28), dial, cam, -0.046, 0.0815, 0.001)
    mesh(new THREE.BoxGeometry(0.03, 0.002, 0.006), chrome, cam, 0.05, 0.0845, -0.006).rotation.y = 0.5
    for (const sx of [-1, 1]) mesh(new THREE.TorusGeometry(0.004, 0.0012, 6, 12), chrome, cam, sx * 0.071, 0.058, 0).rotation.y = Math.PI / 2
  }

  // lens caps and a film canister
  {
    const capTop = makeCanvas(128, 128)
    {
      const g = capTop.getContext('2d')
      g.fillStyle = '#151515'
      g.fillRect(0, 0, 128, 128)
      for (let r = 60; r > 8; r -= 3) {
        g.strokeStyle = r > 50 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'
        g.lineWidth = 1
        g.beginPath()
        g.arc(64, 64, r, 0, Math.PI * 2)
        g.stroke()
      }
    }
    const capFace = new THREE.MeshStandardMaterial({ map: canvasTexture(THREE, capTop), roughness: 0.55 })
    const capSide = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, flatShading: true })
    const capGeo = new THREE.CylinderGeometry(0.0265, 0.0265, 0.0075, 60)
    capGeo.translate(0, 0.00375, 0)
    for (const [x, z, flip] of [[0.43, 0.51, false], [0.53, 0.57, true]]) {
      const cap = mesh(capGeo, [capSide, capFace, capFace], root, x, flip ? 0.0075 : 0, z)
      if (flip) cap.rotation.x = Math.PI
    }
    const label = makeCanvas(256, 64)
    {
      const g = label.getContext('2d')
      g.fillStyle = '#d8a31c'
      g.fillRect(0, 0, 256, 64)
      g.fillStyle = '#1b1712'
      g.fillRect(0, 40, 256, 24)
      g.fillStyle = '#1b1712'
      g.font = `700 26px ${SERIF}`
      g.textBaseline = 'middle'
      g.fillText('400', 18, 21)
      g.fillText('400', 146, 21)
      g.fillStyle = '#d8a31c'
      g.font = `600 14px ${SERIF}`
      g.fillText('FILM · 36 EXP', 18, 52)
      g.fillText('FILM · 36 EXP', 146, 52)
    }
    const can = new THREE.Group()
    can.position.set(0.47, 0.0125, 0.13)
    can.rotation.y = 0.8
    root.add(can)
    const body = mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.046, 32, 1, true), new THREE.MeshStandardMaterial({ map: canvasTexture(THREE, label), metalness: 0.35, roughness: 0.4 }), can)
    body.rotation.z = Math.PI / 2
    for (const sx of [-1, 1]) {
      const end = mesh(new THREE.CylinderGeometry(0.0128, 0.0128, 0.003, 32), chrome, can, sx * 0.0245, 0, 0)
      end.rotation.z = Math.PI / 2
    }
    const spool = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 12), blackMatte, can, 0.0295, 0, 0)
    spool.rotation.z = Math.PI / 2
    // the film leader
    mesh(new THREE.BoxGeometry(0.03, 0.0003, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.35 }), can, -0.002, -0.0123, 0.014).rotation.y = 0.15
  }

  /* light in the air ---------------------------------------------------------------- */
  const L = world.sunDir.clone().negate() // the way sunlight travels
  const inWindowBeam = (x, y, z) => {
    if (y < 0) return false
    const k = (WX - x) / L.x
    const qy = y + L.y * k
    const qz = z + L.z * k
    if (qz < WIN.z0 || qz > WIN.z1 || qy < WIN.y0 || qy > WIN.y1) return false
    if (Math.abs(qy - MULL.y) < MULL.half || MULL.z.some((mz) => Math.abs(qz - mz) < MULL.half)) return false
    return true
  }
  let shaftMat = null
  if (!low) {
    const bmin = W(WX, 0, -1.9)
    const bmax = W(1.3, 1.5, 2.2)
    shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uMin: { value: bmin },
        uMax: { value: bmax },
        uL: { value: L.clone() },
        uWX: { value: WX * S },
        uWin: { value: new THREE.Vector4(WIN.z0 * S, WIN.z1 * S, WIN.y0 * S, WIN.y1 * S) },
        uMull: { value: new THREE.Vector4(MULL.z[0] * S, MULL.z[1] * S, MULL.y * S, MULL.half * S) },
        uColor: { value: new THREE.Color(0xffc48a) },
        uDensity: { value: 0.0055 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uMin; uniform vec3 uMax; uniform vec3 uL; uniform float uWX; uniform vec4 uWin; uniform vec4 uMull;
        uniform vec3 uColor; uniform float uDensity; uniform float uTime;
        varying vec3 vWorld;
        float lit(vec3 p) {
          float k = (uWX - p.x) / uL.x;
          vec3 q = p + uL * k;
          if (q.z < uWin.x || q.z > uWin.y || q.y < uWin.z || q.y > uWin.w) return 0.0;
          if (abs(q.z - uMull.x) < uMull.w || abs(q.z - uMull.y) < uMull.w || abs(q.y - uMull.z) < uMull.w) return 0.0;
          // soft edges and drifting dust in the beam
          float e = min(min(q.z - uWin.x, uWin.y - q.z), min(q.y - uWin.z, uWin.w - q.y));
          float d = 0.75 + 0.25 * sin(q.z * 0.9 + q.y * 0.7 + uTime * 0.15) * sin(q.y * 1.7 - uTime * 0.1);
          return smoothstep(0.0, 1.2, e) * d * exp(-max(-k, 0.0) * 0.012);
        }
        void main() {
          vec3 ro = cameraPosition;
          vec3 rd = normalize(vWorld - ro);
          vec3 inv = 1.0 / rd;
          vec3 t0 = (uMin - ro) * inv;
          vec3 t1 = (uMax - ro) * inv;
          vec3 tn3 = min(t0, t1);
          vec3 tf3 = max(t0, t1);
          float tn = max(max(max(tn3.x, tn3.y), tn3.z), 0.0);
          float tf = min(min(min(tf3.x, tf3.y), tf3.z), length(vWorld - ro));
          if (tf <= tn) discard;
          const int N = 22;
          float dt = (tf - tn) / float(N);
          float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          float sum = 0.0;
          for (int i = 0; i < N; i++) sum += lit(ro + rd * (tn + (float(i) + j) * dt));
          float phase = 0.35 + 1.6 * pow(max(dot(rd, uL), 0.0), 5.0);
          gl_FragColor = vec4(uColor * sum * dt * uDensity * phase, 1.0);
        }`,
    })
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shaftMat)
    // the box is given in desk metres inside the scaled root
    shaft.scale.set(1.3 - WX, 1.5, 4.1)
    shaft.position.set((1.3 + WX) / 2, 0.75, 0.15)
    shaft.frustumCulled = false
    shaft.renderOrder = 5
    root.add(shaft)
  }
  // dust motes turning in the sunlight and under the lamp
  let motesMat
  {
    const n = low ? 160 : 420
    const posA = []
    const rnd = []
    let tries = 0
    while (posA.length / 3 < n * 0.7 && tries++ < 40000) {
      const x = range(rand, WX + 0.1, 1.0)
      const y = range(rand, 0.02, 0.8)
      const z = range(rand, -1.2, 1.2)
      if (!inWindowBeam(x, y, z)) continue
      posA.push(x, y, z)
    }
    while (posA.length / 3 < n) {
      const s = range(rand, 0.06, 0.4)
      const r = Math.sqrt(rand()) * s * Math.tan(0.55)
      const a = rand() * Math.PI * 2
      const side = V(1, 0, 0).cross(lampDir).normalize()
      const up = lampDir.clone().cross(side).normalize()
      const p = LAMP_H.clone().addScaledVector(lampDir, s).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r)
      if (p.y < 0.01) continue
      posA.push(p.x, p.y, p.z)
    }
    for (let i = 0; i < posA.length / 3; i++) rnd.push(rand(), rand(), rand(), rand())
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3))
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 4))
    motesMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: 0.0009 * S }, uAmp: { value: 0.018 }, uColor: { value: new THREE.Color(1.6, 1.25, 0.85) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uSize; uniform float uAmp;
        attribute vec4 aRand; varying float vA;
        void main() {
          vec3 p = position + vec3(
            sin(uTime * 0.11 * (0.5 + aRand.x) + aRand.y * 6.283),
            sin(uTime * 0.07 * (0.5 + aRand.z) + aRand.w * 6.283) * 0.7,
            cos(uTime * 0.09 * (0.5 + aRand.y) + aRand.x * 6.283)) * uAmp;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * (0.4 + aRand.w) * 1000.0 / -mv.z, 1.0, 7.0);
          vA = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aRand.z * 1.4) + aRand.x * 20.0), 3.0)) * (0.5 + aRand.y * 0.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          gl_FragColor = vec4(uColor * smoothstep(0.25, 0.0, d) * vA, 1.0);
        }`,
    })
    const motes = new THREE.Points(geo, motesMat)
    motes.frustumCulled = false
    root.add(motes)
  }
  // glow round the bulb
  {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE, 'rgba(255,214,160,1)'), color: 0xffd6a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.position.copy(LAMP_H).addScaledVector(lampDir, 0.06)
    glow.scale.setScalar(0.11)
    root.add(glow)
  }

  root.updateMatrixWorld(true)
  world.focusShadows(W(-0.25, 0, 0.2), 2.3 * S)

  /* the viewpoints --------------------------------------------------------------- */
  const toWorld = (x, y, z) => mapGroup.localToWorld(V(x, y, z))
  const overview = { pos: W(0.06, 1.02, 1.14), look: W(0.0, 0.0, -0.07) }
  const spots = [overview]
  memories.forEach((m, i) => {
    const s = Math.sin(m.phi)
    const c = Math.cos(m.phi)
    const lift = m.lifted ? 0.07 : 0
    const camP = toWorld(m.pos.x + s * CAM_D, CAM_Y + lift, m.pos.z + c * CAM_D)
    // the print sits a little off-centre, alternating sides, the map running away behind it
    const side = (i % 2 ? -1 : 1) * 0.04
    const lookP = toWorld(m.pos.x + c * side, 0.046, m.pos.z - s * side)
    spots.push({ pos: camP, look: lookP })
  })

  const path = {
    positions: [W(0.55, 2.7, 2.5), W(0.3, 1.8, 1.8), overview.pos.clone()],
    targets: [W(0, 0, -0.25), W(0, 0, -0.12), overview.look.clone()],
    fov: 40,
    near: 0.05,
    spots,
  }

  return {
    scene,
    world,
    path,
    memorySpot: (i) => i + 1,
    prints: prints.map((p) => ({ slug: p.memory.slug, object: p.pivot })),
    update(t) {
      for (const p of prints) p.pivot.rotation.x = -0.05 + Math.sin(t * 0.55 + p.phase) * 0.006
      if (steamMat) steamMat.uniforms.uTime.value = t
      if (motesMat) motesMat.uniforms.uTime.value = t
      if (shaftMat) shaftMat.uniforms.uTime.value = t
    },
  }
}

/** The white frame of a print, with its title written in the bottom strip. */
function captionMaterial(THREE, m, i) {
  const w = 256
  const h = Math.round((w * FRAME_H) / FRAME_W)
  const c = makeCanvas(w, h)
  const g = c.getContext('2d')
  const px = w / FRAME_W
  g.fillStyle = '#f4f1ea'
  g.fillRect(0, 0, w, h)
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, 'rgba(255,255,255,0.4)')
  grd.addColorStop(1, 'rgba(210,200,185,0.25)')
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  // the photo's window, slightly recessed
  const x0 = ((FRAME_W - PHOTO) / 2) * px
  const y0 = PHOTO_TOP * px
  g.fillStyle = 'rgba(120,110,100,0.5)'
  g.fillRect(x0 - 1.5, y0 - 1.5, PHOTO * px + 3, PHOTO * px + 3)
  const strip = y0 + PHOTO * px
  const title = String(m.title || m.slug || '').trim()
  g.fillStyle = '#20263a'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = 26
  g.font = `${size}px ${HAND}`
  while (g.measureText(title).width > w * 0.86 && size > 12) {
    size -= 1
    g.font = `${size}px ${HAND}`
  }
  g.save()
  g.translate(w / 2, strip + (h - strip) * 0.32)
  g.rotate(-0.025 + ((i * 37) % 7) * 0.006)
  g.fillText(title, 0, 0)
  g.restore()
  const city = String(m.city || m.labelCity || '').split(',')[0].trim()
  if (city) {
    g.font = `11px ${SERIF}`
    g.fillStyle = 'rgba(40,40,50,0.7)'
    spaced(g, city.toUpperCase(), w / 2, strip + (h - strip) * 0.6, 2, false)
  }
  return new THREE.MeshStandardMaterial({ map: canvasTexture(THREE, c), roughness: 0.5 })
}

/** The notebook's open spread: a handwritten list of the shoots, a doodle. */
function notebookTexture(THREE, memories) {
  const w = 1024
  const h = 720
  const c = makeCanvas(w, h)
  const g = c.getContext('2d')
  g.fillStyle = '#efe7d4'
  g.fillRect(0, 0, w, h)
  // dotted grid
  g.fillStyle = 'rgba(120,110,95,0.35)'
  for (let y = 40; y < h - 20; y += 26) for (let x = 30; x < w - 20; x += 26) if (Math.abs(x - w / 2) > 18) g.fillRect(x, y, 2, 2)
  // the gutter's shadow
  const gut = g.createLinearGradient(w / 2 - 60, 0, w / 2 + 60, 0)
  gut.addColorStop(0, 'rgba(0,0,0,0)')
  gut.addColorStop(0.5, 'rgba(70,50,30,0.25)')
  gut.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = gut
  g.fillRect(w / 2 - 60, 0, 120, h)
  g.fillStyle = '#1f2a48'
  g.textBaseline = 'alphabetic'
  g.font = `40px ${HAND}`
  g.save()
  g.translate(56, 92)
  g.rotate(-0.02)
  g.fillText('Memories', 0, 0)
  g.restore()
  g.font = `24px ${HAND}`
  memories.slice(0, 13).forEach((m, i) => {
    const line = `${i + 1}. ${String(m.title || m.slug || '').slice(0, 22)}${m.city ? ' — ' + String(m.city).split(',')[0] : ''}`
    g.save()
    g.translate(60 + (i % 2) * 3, 150 + i * 40)
    g.rotate(-0.012 + (i % 3) * 0.008)
    g.fillText(line, 0, 0)
    g.restore()
  })
  // a doodled route with circles, and a few notes
  const rand = seeded(9)
  g.strokeStyle = '#1f2a48'
  g.lineWidth = 2.2
  g.lineCap = 'round'
  g.beginPath()
  let x = 600
  let y = 600
  g.moveTo(x, y)
  const pts = []
  for (let i = 0; i < 6; i++) {
    const nx = 590 + rand() * 360
    const ny = 560 - i * 85 + rand() * 30
    g.bezierCurveTo(x + 60, y - 10, nx - 60, ny + 30, nx, ny)
    pts.push([nx, ny])
    x = nx
    y = ny
  }
  g.stroke()
  for (const [px, py] of pts) {
    g.beginPath()
    g.arc(px, py, 9, 0, Math.PI * 2)
    g.stroke()
  }
  g.font = `22px ${HAND}`
  g.fillText('golden hour ~ 20:40', 600, 660)
  g.fillText('85mm · f/1.8', 820, 120)
  g.strokeStyle = 'rgba(160,30,30,0.8)'
  g.beginPath()
  g.ellipse(880, 112, 80, 24, -0.05, 0, Math.PI * 2)
  g.stroke()
  return canvasTexture(THREE, c)
}
