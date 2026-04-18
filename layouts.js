// Layout engines — produce {x, y, w, h, rot} per photo in PIXELS.
// Also return stageH (the total pixel height of the stage) so the page can scroll.

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick shortest column for masonry packing.
function shortestCol(heights) {
  let min = heights[0], idx = 0;
  for (let i = 1; i < heights.length; i++) {
    if (heights[i] < min) { min = heights[i]; idx = i; }
  }
  return idx;
}

// ------- SCATTERED (home) ---------
// Masonry: N columns, variable-height tiles, page scrolls vertically.
function scatteredLayout(photos, seed, opts = {}) {
  const { vw = 1600, vh = 1000 } = opts;
  const mobile = vw < 720;
  const rng = makeRng(seed);

  const cols = mobile ? 2 : 3;
  const padX = mobile ? 16 : 40;
  const gap  = mobile ? 10 : 24;
  const topPad    = mobile ? 120 : 180;
  const bottomPad = mobile ? 60  : 80;

  const cellW = (vw - 2 * padX - gap * (cols - 1)) / cols;

  const colHeights = Array(cols).fill(topPad);
  const shuffled = shuffle(photos, rng);
  const out = new Array(photos.length);

  for (const p of shuffled) {
    const iCol = shortestCol(colHeights);
    const tileW = cellW;
    const tileH = tileW / p.ratio;
    const x = padX + iCol * (cellW + gap);
    const y = colHeights[iCol];
    out[p.index] = { x, y, w: tileW, h: tileH, rot: 0, z: 0 };
    colHeights[iCol] += tileH + gap;
  }

  const stageH = Math.max(vh, Math.max(...colHeights) + bottomPad);
  return { items: out, stageH };
}

// ------- GROUPED (collections) --------
// Sections (one per collection) laid out in a 2-col (desktop) or 1-col (mobile)
// meta-grid, each section using an inner 2-col masonry for its photos.
function groupedLayout(photos, seed, opts = {}) {
  const { vw = 1600, vh = 1000 } = opts;
  const mobile = vw < 720;

  const byCollection = {};
  for (const p of photos) {
    (byCollection[p.collection] = byCollection[p.collection] || []).push(p);
  }
  const collectionOrder = window.COLLECTIONS.map(c => c.id);

  const sectionCols = mobile ? 1 : 2;
  const padX        = mobile ? 16 : 40;
  const gapX        = mobile ? 0  : 28;
  const sectionGap  = mobile ? 40 : 56;
  const topPad      = mobile ? 100 : 160;
  const bottomPad   = mobile ? 60  : 80;
  const labelH      = mobile ? 28  : 36;
  const innerCols   = 2;
  const innerGap    = mobile ? 8 : 14;

  const sectionW = (vw - 2 * padX - gapX * (sectionCols - 1)) / sectionCols;
  const tileW    = (sectionW - innerGap * (innerCols - 1)) / innerCols;

  const metaColHeights = Array(sectionCols).fill(topPad);
  const items  = new Array(photos.length);
  const labels = [];

  for (const colId of collectionOrder) {
    const cPhotos = byCollection[colId] || [];
    if (!cPhotos.length) continue;
    const col  = window.COLLECTIONS.find(c => c.id === colId);
    const name = col ? col.name : colId;
    const rng  = makeRng(seed + collectionOrder.indexOf(colId) + 1);
    const ordered = shuffle(cPhotos, rng);

    const iSection = shortestCol(metaColHeights);
    const sx = padX + iSection * (sectionW + gapX);
    let sy   = metaColHeights[iSection];

    labels.push({ id: colId, name, x: sx, y: sy, align: 'left' });
    sy += labelH;

    const innerHeights = Array(innerCols).fill(0);
    for (const p of ordered) {
      const iInner = shortestCol(innerHeights);
      const tW = tileW;
      const tH = tW / p.ratio;
      const x = sx + iInner * (tileW + innerGap);
      const y = sy + innerHeights[iInner];
      items[p.index] = { x, y, w: tW, h: tH, rot: 0 };
      innerHeights[iInner] += tH + innerGap;
    }

    const sectionContentH = Math.max(...innerHeights);
    metaColHeights[iSection] = sy + sectionContentH + sectionGap;
  }

  const stageH = Math.max(vh, Math.max(...metaColHeights) + bottomPad);
  return { items, labels, stageH };
}

window.Layouts = { scatteredLayout, groupedLayout, makeRng };
