/**
 * Pure layout for the chest panel — no canvas, no browser globals, so the
 * geometry can be unit-tested in node.
 *
 * The panel used to be a hardcoded 340x560 box. That is taller than the whole
 * canvas in landscape (640x400), so the backpack rows were drawn below the
 * bottom edge and could not be seen or tapped. Everything here is sized from
 * the viewport instead, and landscape splits into two columns the way
 * drawCreativePanel already does.
 */

const CHEST_COLS = 4;
const CHEST_ROWS = 4;
const BAG_COLS = 6;

/** Baseline offsets inside the header, from the panel top. */
const TITLE_Y = 30;
const HINT_Y = 48;
const HEADER_H = 62;
const FOOTER_H = 26;
/** A label sits this far above the first row of its grid. */
const LABEL_GAP = 16;

function grid(items, x, y, cols, cell, gap) {
  const out = [];
  for (let i = 0; i < items; i++) {
    out.push({
      i,
      x: x + (i % cols) * (cell + gap),
      y: y + Math.floor(i / cols) * (cell + gap),
      w: cell,
      h: cell,
    });
  }
  return out;
}

/** Width of a `cols`-wide grid of `cell` boxes separated by `gap`. */
const spanOf = (cols, cell, gap) => cols * (cell + gap) - gap;

/**
 * @param {number} W viewport width in render units
 * @param {number} H viewport height in render units
 * @param {number} bagLen number of backpack slots
 * @param {number} hotbarLen number of hotbar slots
 */
export function chestPanelLayout(W, H, bagLen, hotbarLen) {
  const landscape = W > H;
  const cell = landscape ? 30 : 36;
  const gap = 6;
  const pad = 16;
  const colGap = 24;
  const bagRows = Math.ceil(bagLen / BAG_COLS);

  const chestSpan = spanOf(CHEST_COLS, cell, gap);
  const hotbarSpan = spanOf(hotbarLen, cell, gap);
  const bagSpan = spanOf(BAG_COLS, cell, gap);
  const chestH = LABEL_GAP + spanOf(CHEST_ROWS, cell, gap);
  const invH = LABEL_GAP + cell + 20 + LABEL_GAP + spanOf(bagRows, cell, gap);

  let pw, ph, chestX, chestY, invX, invY;

  if (landscape) {
    // Chest on the left, hotbar + backpack on the right.
    const contentW = chestSpan + colGap + Math.max(hotbarSpan, bagSpan);
    pw = Math.min(W - 20, contentW + pad * 2);
    ph = Math.min(H - 12, HEADER_H + Math.max(chestH, invH) + FOOTER_H);
  } else {
    // Everything stacked in one column.
    const contentW = Math.max(chestSpan, hotbarSpan, bagSpan);
    pw = Math.min(W - 16, contentW + pad * 2);
    ph = Math.min(H - 12, HEADER_H + chestH + 20 + invH + FOOTER_H);
  }

  const px = (W - pw) / 2;
  const py = Math.max(6, (H - ph) / 2);
  const contentTop = py + HEADER_H;

  if (landscape) {
    chestX = px + pad;
    invX = chestX + chestSpan + colGap;
    chestY = contentTop;
    invY = contentTop;
  } else {
    chestX = px + pad;
    invX = px + pad;
    chestY = contentTop;
    invY = chestY + chestH + 20;
  }

  const chestSlotsY = chestY + LABEL_GAP;
  const hotbarY = invY + LABEL_GAP;
  const bagLabelY = hotbarY + cell + 20;
  const bagSlotsY = bagLabelY + LABEL_GAP;

  return {
    landscape,
    cell,
    gap,
    panel: { x: px, y: py, w: pw, h: ph },
    close: { x: px + pw - 44, y: py + 10, w: 32, h: 32 },
    chestSlots: grid(CHEST_COLS * CHEST_ROWS, chestX, chestSlotsY, CHEST_COLS, cell, gap),
    hotbarSlots: grid(hotbarLen, invX, hotbarY, hotbarLen, cell, gap),
    bagSlots: grid(bagLen, invX, bagSlotsY, BAG_COLS, cell, gap),
    labels: {
      title: { x: px + 16, y: py + TITLE_Y },
      headerHint: { x: px + 16, y: py + HINT_Y },
      chest: { x: chestX, y: chestSlotsY - 5 },
      hotbar: { x: invX, y: hotbarY - 5 },
      bag: { x: invX, y: bagSlotsY - 5 },
      footer: { x: px + pw / 2, y: py + ph - 10 },
    },
  };
}
