// Layout engines — produce {x, y, w, h, rot} per photo
// x, y, w, h in % of the stage dimensions. Rotation is ALWAYS 0 — straight.
// Photos may be portrait, landscape, or square. Their native aspect is used.

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

// Convert a photo's native ratio (w/h) into stage-coordinate w% / h% where
// w% is given and h% is derived.
// In stage-% coords: (w% * stageW) / (h% * stageH) = ratio
// => h% = w% / ratio * (stageW / stageH) = w% / ratio * stageAspect
function aspectToStageH(wPct, ratio, stageAspect) {
  return (wPct / ratio) * stageAspect;
}

// ------- SCATTERED (home) ---------
// Place each photo inside a jittered grid cell. Tile size is chosen per-photo
// so the tile fits in the cell regardless of orientation.
function scatteredLayout(photos, seed, opts = {}) {
  const { vw = 1600, vh = 1000 } = opts;
  const stageAspect = vw / vh;
  const mobile = stageAspect < 0.9;

  const rng = makeRng(seed);

  const SAFE = mobile
    ? { top: 22, bottom: 98, left: 3, right: 97 }
    : { top: 11, bottom: 97, left: 4, right: 96 };

  // Bio band sits in the top-left — covers "lxmuresan" + tagline so no
  // photos clip into the text.
  const bio = mobile ? null : { x1: 0, y1: 0, x2: 22, y2: 10 };

  const N = photos.length;

  const usableW = SAFE.right - SAFE.left;
  const usableH = SAFE.bottom - SAFE.top;

  // Grid: pick cols so that (cols * rows - blockedCells) ≈ N exactly,
  // keeping cells roughly square in stage coords.
  let cols, rows;
  if (mobile) {
    cols = 3;
    rows = Math.ceil(N / cols);
  } else {
    // Try a range and pick the layout whose cell count fits N best while
    // keeping cells reasonably square (cellW% * stageAspect ≈ cellH%).
    let best = null;
    for (let c = 6; c <= 11; c++) {
      const cellW = usableW / c;
      // Blocked cells in row 0: those whose x-range overlaps the bio band.
      let blocked = 0;
      if (bio) {
        for (let gx = 0; gx < c; gx++) {
          const cx1 = SAFE.left + gx * cellW;
          const cx2 = cx1 + cellW;
          if (cx1 < bio.x2 && cx2 > bio.x1) blocked++;
        }
      }
      const r = Math.ceil((N + blocked) / c);
      const cellH = usableH / r;
      const aspect = (cellW * stageAspect) / cellH;
      const score = Math.abs(Math.log(aspect));
      const totalCells = c * r - blocked;
      const slack = totalCells - N;
      const total = score + slack * 0.06;
      if (!best || total < best.total) best = { c, r, total };
    }
    cols = best.c;
    rows = best.r;
  }

  const cellW = usableW / cols;
  const cellH = usableH / rows;

  // Per-tile sizing: fit in cell with margin; keep native aspect.
  const marginFrac = mobile ? 0.22 : 0.24;
  const innerW = cellW * (1 - marginFrac);
  const innerH = cellH * (1 - marginFrac);

  // Build available cells: skip cells whose horizontal range overlaps the
  // bio band (top row only). Bio sits above the grid vertically (SAFE.top
  // is below bio.y2), so the only conflict is x-jitter pushing a row-0 tile
  // upward/leftward into the bio.
  const cellIndices = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx1 = SAFE.left + gx * cellW;
      const cx2 = cx1 + cellW;
      if (gy === 0 && bio && cx1 < bio.x2 && cx2 > bio.x1) continue;
      cellIndices.push({
        cx: cx1 + cellW / 2,
        cy: SAFE.top + gy * cellH + cellH / 2,
        row: gy,
      });
    }
  }
  const shuffled = shuffle(cellIndices, rng);
  const takeCount = Math.min(N, shuffled.length);

  const out = [];
  for (let i = 0; i < N; i++) {
    if (i >= takeCount) {
      out.push({ x: -999, y: -999, w: 1, h: 1, rot: 0, z: i });
      continue;
    }
    const slot = shuffled[i];
    const ratio = photos[i].ratio; // w / h
    // Fit tile to innerW / innerH by whichever is tighter.
    // Candidate 1: w = innerW → h = aspectToStageH(innerW, ratio, stageAspect)
    // Candidate 2: h = innerH → w = innerH * ratio / stageAspect
    const h1 = aspectToStageH(innerW, ratio, stageAspect);
    let tileW, tileH;
    if (h1 <= innerH) {
      tileW = innerW;
      tileH = h1;
    } else {
      tileH = innerH;
      tileW = (innerH * ratio) / stageAspect;
    }
    // Leftover room in the cell is split between jitter and margin.
    const jitterX = Math.max(0, (cellW - tileW) / 2) * 0.6;
    const jitterY = Math.max(0, (cellH - tileH) / 2) * 0.6;
    const jx = (rng() - 0.5) * 2 * jitterX;
    const jy = (rng() - 0.5) * 2 * jitterY;
    const x = slot.cx - tileW / 2 + jx;
    const y = slot.cy - tileH / 2 + jy;
    out.push({ x, y, w: tileW, h: tileH, rot: 0, z: i });
  }
  return out;
}

// ------- GROUPED (collections) --------
// Per-collection cell with a label band and a row-based packing area.
// Row packing: fit tiles into fixed-height rows, breaking to new row when
// the current row would exceed the cell width. Prevents overlap by design.
function groupedLayout(photos, seed, opts = {}) {
  const { vw = 1600, vh = 1000 } = opts;
  const stageAspect = vw / vh;
  const mobile = stageAspect < 0.9;
  const rng = makeRng(seed);

  const byCollection = {};
  for (const p of photos) {
    (byCollection[p.collection] = byCollection[p.collection] || []).push(p);
  }
  const collectionOrder = window.COLLECTIONS.map(c => c.id);

  const cols = mobile ? 1 : 2;
  const rows = Math.ceil(collectionOrder.length / cols);

  const M = mobile
    ? { top: 8, bottom: 3, left: 4, right: 4, gutterX: 0, gutterY: 4 }
    : { top: 13, bottom: 4, left: 5, right: 5, gutterX: 4, gutterY: 5 };

  const innerW = 100 - M.left - M.right - M.gutterX * (cols - 1);
  const innerH = 100 - M.top - M.bottom - M.gutterY * (rows - 1);
  const cellW = innerW / cols;
  const cellH = innerH / rows;

  const labelBandH = mobile ? 4.5 : 5.5;
  const photoBandPadTop = mobile ? 1 : 1.5;

  const items = [];
  const labels = [];

  collectionOrder.forEach((colId, ci) => {
    const col = window.COLLECTIONS.find(c => c.id === colId);
    const name = col ? col.name : colId;
    const cPhotos = shuffle(byCollection[colId] || [], makeRng(seed + ci + 1));

    const cellCol = ci % cols;
    const cellRow = Math.floor(ci / cols);
    const cellX = M.left + cellCol * (cellW + M.gutterX);
    const cellY = M.top  + cellRow * (cellH + M.gutterY);

    labels.push({ id: colId, name, x: cellX, y: cellY, align: 'left' });

    const areaX = cellX;
    const areaY = cellY + labelBandH + photoBandPadTop;
    const areaW = cellW;
    const areaH = cellH - labelBandH - photoBandPadTop;

    // Pick a fixed tile height that lets us fit ~packRows rows.
    // Desktop: try 2 rows; mobile: 2 rows too (since column is wider).
    const packRows = mobile ? 3 : 2;
    const gap = mobile ? 1.2 : 1.0;
    const tileH = (areaH - gap * (packRows - 1)) / packRows;
    // For each photo, its tileW at this tileH is:
    //   tileW% = tileH% * ratio / stageAspect
    // Sum tileW across a row; break when > areaW.
    const rowsPacked = [];
    let curRow = [];
    let curWidth = 0;
    for (const p of cPhotos) {
      const tileW = (tileH * p.ratio) / stageAspect;
      const addWidth = (curRow.length === 0 ? tileW : tileW + gap);
      if (curWidth + addWidth > areaW && curRow.length > 0) {
        rowsPacked.push(curRow);
        curRow = [];
        curWidth = 0;
      }
      const tw = (tileH * p.ratio) / stageAspect;
      curRow.push({ photo: p, w: tw, h: tileH });
      curWidth += (curRow.length === 1 ? tw : tw + gap);
    }
    if (curRow.length > 0) rowsPacked.push(curRow);

    // If we packed more rows than packRows, scale down tile height to compress.
    // (Rare with our defaults, but defensive.)
    const extraRows = rowsPacked.length - packRows;
    let scale = 1;
    if (extraRows > 0) {
      // Target: fit rowsPacked.length into areaH.
      const idealH = (areaH - gap * (rowsPacked.length - 1)) / rowsPacked.length;
      scale = idealH / tileH;
    }

    // Place each row, centered horizontally within the cell.
    const finalTileH = tileH * scale;
    const totalRowsH = finalTileH * rowsPacked.length + gap * (rowsPacked.length - 1);
    const rowYStart = areaY + Math.max(0, (areaH - totalRowsH) / 2);

    rowsPacked.forEach((row, ri) => {
      const rowWidth = row.reduce((s, t, idx) => s + t.w * scale + (idx > 0 ? gap : 0), 0);
      let xCursor = areaX + (areaW - rowWidth) / 2;
      const yRow = rowYStart + ri * (finalTileH + gap);
      for (const tile of row) {
        const w = tile.w * scale;
        const h = finalTileH;
        items.push({
          x: xCursor,
          y: yRow,
          w, h,
          rot: 0,
          cluster: colId,
          _photo: tile.photo,
        });
        xCursor += w + gap;
      }
    });
  });

  // Reindex by original photo index so app consumes a parallel array.
  const byPhotoIndex = new Array(photos.length);
  for (const it of items) {
    byPhotoIndex[it._photo.index] = it;
    delete it._photo;
  }
  return { items: byPhotoIndex, labels };
}

window.Layouts = { scatteredLayout, groupedLayout, makeRng };
