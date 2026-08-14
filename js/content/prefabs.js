/**
 * Prefab structures for the instant-builds cheat — data only, matching the
 * other content/ catalogs.
 *
 * Grid conventions:
 * - `rows[0]` is the TOP row; the tap anchors the grid's bottom-centre.
 * - `' '` (space) leaves whatever tile is already there. Use it for the corners
 *   outside a roof line so a build never punches a square hole in the hillside.
 * - `'.'` forces AIR. Interiors must be carved explicitly, or the surrounding
 *   dirt stays and the "room" is solid ground.
 * - Every other character must exist in that prefab's `legend`.
 *
 * These are drawn in a side-on cross-section, so a door belongs in a *side*
 * wall at floor level — a door in the middle of the floor row reads as a hole,
 * not an entrance. Every enclosed room also carries its own light: a sealed
 * room with no torch renders as a black box and looks broken.
 */

import { BLOCK } from './blocks.js';

export const PREFABS = [
  {
    id: 'starter-hut',
    name: 'Starter Hut',
    icon: '🏚️',
    group: 'Homes',
    legend: {
      P: BLOCK.PLANKS,
      D: BLOCK.DOOR,
      T: BLOCK.TORCH,
    },
    rows: [
      ' PPPPP ',
      'PPPPPPP',
      'P..T..P',
      'P.....P',
      'D.....P',
      'PPPPPPP',
    ],
  },
  {
    id: 'cosy-cottage',
    name: 'Cosy Cottage',
    icon: '🏠',
    group: 'Homes',
    legend: {
      P: BLOCK.PLANKS,
      G: BLOCK.GLASS,
      D: BLOCK.DOOR,
      L: BLOCK.LANTERN,
      B: BLOCK.BED,
    },
    rows: [
      '   PPP   ',
      '  PPPPP  ',
      ' PPPPPPP ',
      'PPPPPPPPP',
      'P.G...G.P',
      'P...L...P',
      'D......BP',
      'PPPPPPPPP',
    ],
  },
  {
    id: 'treehouse',
    name: 'Treehouse',
    icon: '🌳',
    group: 'Homes',
    legend: {
      P: BLOCK.PLANKS,
      W: BLOCK.WOOD,
      E: BLOCK.LEAVES,
      L: BLOCK.LADDER,
      T: BLOCK.TORCH,
      D: BLOCK.DOOR,
    },
    // The ladder runs unbroken from the ground, through the floor hatch, and
    // into the room. Stopping it under the hatch left the climb with nothing to
    // grab at the top, so there was no way in.
    //
    // The door belongs at the *base* of the trunk, beside the foot of the
    // ladder — you walk in at ground level and climb up. A door in the room
    // wall five blocks up is one nobody can reach.
    rows: [
      '  EEEEE  ',
      ' EEPPPEE ',
      ' PPPPPPP ',
      ' PT....P ',
      ' P..L..P ',
      ' PPPLPPP ',
      '   WLW   ',
      '   WLW   ',
      // '.' leaves room for the door's top half, which placePrefab grows into.
      '   .LW   ',
      '   DLW   ',
    ],
  },
  {
    id: 'fountain',
    name: 'Fountain',
    icon: '⛲',
    group: 'Fun',
    legend: {
      B: BLOCK.BRICK,
      W: BLOCK.WATER,
      L: BLOCK.LANTERN,
    },
    rows: [
      'L.......L',
      'B.......B',
      'BWWWWWWWB',
      'BWWWWWWWB',
      'BBBBBBBBB',
    ],
  },
  {
    id: 'swimming-pool',
    name: 'Swimming Pool',
    icon: '🏊',
    group: 'Fun',
    legend: {
      S: BLOCK.STONE,
      W: BLOCK.WATER,
      L: BLOCK.LADDER,
    },
    // The pool sits on the ground, so its rim stands four blocks up — with
    // sheer walls there was no way in or out. The ladder goes on the *outside*
    // of the wall: a ladder tile is not solid, so putting one in the wall
    // itself would drain the pool through it.
    rows: [
      '.............',
      'L.S.........S',
      'L.SWWWWWWWWWS',
      'L.SWWWWWWWWWS',
      'L.SWWWWWWWWWS',
      'LSSSSSSSSSSSS',
    ],
  },
  {
    id: 'campfire-circle',
    name: 'Campfire Circle',
    icon: '🔥',
    group: 'Fun',
    legend: {
      C: BLOCK.CAMPFIRE,
      W: BLOCK.WOOD,
      P: BLOCK.PLANKS,
    },
    rows: [
      '.........',
      '.........',
      'W...C...W',
      'PPPPPPPPP',
    ],
  },
  {
    id: 'watchtower',
    name: 'Watchtower',
    icon: '🗼',
    group: 'Landmarks',
    legend: {
      S: BLOCK.STONE,
      L: BLOCK.LADDER,
      D: BLOCK.DOOR,
      T: BLOCK.TORCH,
      N: BLOCK.LANTERN,
    },
    rows: [
      '  SSS  ',
      ' S...S ',
      ' S.N.S ',
      ' SS.SS ',
      ' S.L.S ',
      ' S.L.S ',
      ' S.LTS ',
      ' S.L.S ',
      ' S.L.S ',
      ' SDL.S ',
      ' SSSSS ',
    ],
  },
  {
    id: 'bridge',
    name: 'Bridge',
    icon: '🌉',
    group: 'Landmarks',
    legend: {
      P: BLOCK.PLANKS,
      W: BLOCK.WOOD,
      T: BLOCK.TORCH,
    },
    rows: [
      'T..W..T..W..T',
      'W..W..W..W..W',
      '.............',
      'PPPPPPPPPPPPP',
    ],
  },
];

/**
 * Lookup a prefab by id. Returns the prefab object or null if not found.
 * @param {string} id
 */
export function getPrefab(id) {
  return PREFABS.find(p => p.id === id) || null;
}
