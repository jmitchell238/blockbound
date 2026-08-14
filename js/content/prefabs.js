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
      // '.' at the door column leaves room for the door's grown top half.
      '......P',
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
      '....L...P',
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
    id: 'manor',
    name: 'Manor House',
    icon: '🏡',
    group: 'Homes',
    legend: {
      P: BLOCK.PLANKS,
      G: BLOCK.GLASS,
      D: BLOCK.DOOR,
      L: BLOCK.LADDER,
      N: BLOCK.LANTERN,
      T: BLOCK.TORCH,
      B: BLOCK.BED,
      C: BLOCK.CHEST,
      K: BLOCK.WORKBENCH,
      F: BLOCK.FURNACE,
    },
    // Two storeys, two rooms each. Every interior is 4 blocks tall so a child
    // can jump indoors, and the dividing walls stop two rows short so the
    // doorway between rooms is tall enough to walk through.
    //
    // The ladder runs in one unbroken column from the ground floor to the top,
    // passing through the middle floor — a ladder that stops at a ceiling is a
    // ladder to nowhere.
    rows: [
      '     PPPPPPP     ',
      '   PPPPPPPPPPP   ',
      ' PPPPPPPPPPPPPPP ',
      'PPPPPPPPPPPPPPPPP',
      'P...N...P....N.LP',
      'PG......P.....GLP',
      'P..............LP',
      'PB...C.....C...LP',
      'PPPPPPPPPPPPPPPLP',
      'P...T...P....T.LP',
      'PG......P.....GLP',
      '...............LP',
      'D....K...F.....LP',
      'PPPPPPPPPPPPPPPPP',
    ],
  },
  {
    id: 'castle',
    name: 'Castle',
    icon: '🏰',
    group: 'Landmarks',
    legend: {
      S: BLOCK.STONE,
      G: BLOCK.GLASS,
      D: BLOCK.DOOR,
      L: BLOCK.LADDER,
      N: BLOCK.LANTERN,
      T: BLOCK.TORCH,
      B: BLOCK.BED,
      C: BLOCK.CHEST,
      K: BLOCK.WORKBENCH,
      F: BLOCK.FURNACE,
    },
    // Four storeys over a dungeon, 45 wide.
    //
    // Ground floor, left to right: a GREAT ROOM that runs two storeys tall with
    // a hearth, then a dining room, then a kitchen. The two storeys above are
    // bedrooms, four to a floor. Below the slab is a dungeon of four cells.
    //
    // `anchorRow` is the ground-floor slab rather than the bottom row, so the
    // tap lands at ground level and the dungeon is dug in underneath. Without
    // it the whole castle would stand on top of its own basement.
    //
    // Every room is 4 blocks tall inside (the great room is 9), carries its own
    // light, and opens onto its neighbour through a two-block doorway. One
    // ladder at column 39 runs unbroken from the dungeon floor to the top
    // storey — it is the only way between floors, so it must never be cut.
    //
    // A door in *both* outer walls: 45 blocks is a long way to walk around, and
    // a build grows away from where you tapped, so whichever side you approach
    // from there is a way in on that side.
    anchorRow: 21,
    rows: [
      'S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S.S',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
      'S....N.....S....N.....S....N.....S....NL....S',
      'G..........S..........S..........S.....L....G',
      'S......................................L....S',
      'SB.......C..B.......C..B.......C..B....L..C.S',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSLSSSSS',
      'S....N.....S....N.....S....N.....S....NL....S',
      'G..........S..........S..........S.....L....G',
      'S......................................L....S',
      'SB.......C..B.......C..B.......C..B....L..C.S',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSLSSSSS',
      'S..........N..........S....N.....S....NL....S',
      'G.....................S..........S.....L....G',
      'S......................................L....S',
      'S.......................C......C.......L....S',
      'S.....................SSSSSSSSSSSSSSSSSLSSSSS',
      'S..........N..........S....N.....S....NL....S',
      'G.....................S..........S.....L....G',
      '.......................................L.....',
      'D........C.F.C...........K.C.K.....F.C.L....D',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSLSSSSS',
      'S....T.....S....T.....S....T.....S....TL....S',
      'G..........S..........S..........S.....L....G',
      'S......................................L....S',
      'S........C..........C..........C.......L..C.S',
      'SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS',
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
    // A bridge spans a gap on purpose — settling it onto the ground under it
    // would drop it into the very hole it is meant to cross.
    snapToGround: false,
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
