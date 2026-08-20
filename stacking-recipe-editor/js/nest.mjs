// nest.mjs — layer-ordered sheet nesting, shared by the nest editor page and
// the Mozaik job export. Same rules as quarry/scripts/nest-by-layer.mjs:
//
//   * sheets are filled in LAYER ORDER; a layer's leftovers spill onto the
//     next sheet rather than holding a sheet open (Zac 2026-08-18: "no extra
//     sheet — try 1+2/3+4 as much as possible first")
//   * a sheet opens the next layer only when the current ones no longer fit
//   * 16mm between parts (measured off his own hand nest) and 3mm off the
//     sheet edge, enforced by construction: each part packs as a
//     (l+gap) x (w+gap) rect into a (usable+gap) bin
//
// Pure data in, pure data out — no DOM.

export const NEST_DEFAULTS = { gap: 16, edge: 3, sheetL: 2770, sheetW: 1550 };

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

class Bin {
  constructor(L, W) { this.free = [{ x: 0, y: 0, w: L, h: W }]; this.placed = []; }
  best(it, heur, rnd, jitter) {
    let best = null;
    for (const fr of this.free) for (const rot of [0, 90]) {
      const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
      if (w > fr.w + 1e-9 || h > fr.h + 1e-9) continue;
      const lh = fr.w - w, lv = fr.h - h;
      let s = heur === 'bssf' ? Math.min(lh, lv) : heur === 'blsf' ? Math.max(lh, lv)
        : heur === 'baf' ? fr.w * fr.h - w * h : fr.y * 4 + fr.x;
      s += (rnd() - 0.5) * jitter;
      if (!best || s < best.s) best = { s, x: fr.x, y: fr.y, w, h, rot };
    }
    return best;
  }
  put(b, it) {
    this.placed.push({ it, x: b.x, y: b.y, rot: b.rot });
    const next = [];
    for (const fr of this.free) {
      if (b.x >= fr.x + fr.w || b.x + b.w <= fr.x || b.y >= fr.y + fr.h || b.y + b.h <= fr.y) { next.push(fr); continue; }
      if (b.x > fr.x) next.push({ x: fr.x, y: fr.y, w: b.x - fr.x, h: fr.h });
      if (b.x + b.w < fr.x + fr.w) next.push({ x: b.x + b.w, y: fr.y, w: fr.x + fr.w - (b.x + b.w), h: fr.h });
      if (b.y > fr.y) next.push({ x: fr.x, y: fr.y, w: fr.w, h: b.y - fr.y });
      if (b.y + b.h < fr.y + fr.h) next.push({ x: fr.x, y: b.y + b.h, w: fr.w, h: fr.y + fr.h - (b.y + b.h) });
    }
    this.free = next.filter((a, i) => a.w > 1 && a.h > 1 &&
      !next.some((o, j) => j !== i && o.x <= a.x + 1e-9 && o.y <= a.y + 1e-9 &&
        o.x + o.w >= a.x + a.w - 1e-9 && o.y + o.h >= a.y + a.h - 1e-9 && o.w * o.h > a.w * a.h));
  }
}

// parts: [{ name, layer, l, w }] — layer is 1-based
export function nestByLayer(parts, opts = {}) {
  const { gap, edge, sheetL, sheetW } = { ...NEST_DEFAULTS, ...opts };
  const BIN_L = sheetL - 2 * edge + gap, BIN_W = sheetW - 2 * edge + gap;
  const layers = [...new Set(parts.map(p => p.layer))].sort((a, b) => a - b);
  const tooBig = parts.filter(p => Math.min(p.l, p.w) + gap > Math.max(BIN_L, BIN_W)
    || Math.max(p.l, p.w) + gap > Math.max(BIN_L, BIN_W));
  if (tooBig.length) return { error: `${tooBig[0].name} (${tooBig[0].l}x${tooBig[0].w}) is bigger than the sheet` };

  function attempt(cap, heur, seed, jitter) {
    const rnd = mulberry(seed);
    // keep the part's own dims (l0/w0): the packing rect overwrites w/h with
    // the INFLATED size, and reading them back transposed length for width
    // (self-test caught it as 287% utilization).
    let left = parts.map(p => ({ ...p, l0: p.l, w0: p.w, w: p.l + gap, h: p.w + gap }));
    const sheets = [];
    while (left.length) {
      if (sheets.length > 40) return null;
      const bin = new Bin(BIN_L, BIN_W), on = new Set();
      for (;;) {
        const fits = [];
        for (const it of left) { const b = bin.best(it, heur, rnd, jitter); if (b) fits.push({ it, b }); }
        const openable = fits.filter(f => !on.has(f.it.layer)).map(f => f.it.layer).sort((a, b) => a - b)[0];
        let pick = null;
        for (const { it, b } of fits) {
          const isNew = !on.has(it.layer);
          if (isNew && (on.size >= cap || it.layer !== openable)) continue;
          const score = b.s + (isNew ? 1e7 : 0) + it.layer * 1e3;
          if (!pick || score < pick.score) pick = { score, b, it };
        }
        if (!pick) break;
        bin.put(pick.b, pick.it);
        left = left.filter(i => i !== pick.it);
        on.add(pick.it.layer);
      }
      if (!bin.placed.length) return null;
      sheets.push({ bin, layers: [...on].sort((a, b) => a - b) });
    }
    return sheets;
  }

  let best = null;
  for (const cap of [2, 3, 4, 6]) {
    for (let t = 0; t < 240; t++) {
      const r = attempt(cap, ['bssf', 'blsf', 'baf', 'bl'][t % 4], t * 2654435761 + cap, t === 0 ? 0 : (t % 120) * 0.8);
      if (!r) continue;
      const mixed = r.reduce((a, s) => a + s.layers.length, 0);
      if (!best || r.length < best.sheets.length || (r.length === best.sheets.length && mixed < best.mixed))
        best = { sheets: r, mixed, cap };
    }
    if (best) break;                        // lowest cap that nests at all wins
  }
  if (!best) return { error: 'could not nest these parts at this spacing' };

  const SHEET_AREA = sheetL * sheetW;
  return {
    gap, edge, sheetL, sheetW, cap: best.cap,
    sheets: best.sheets.map(({ bin, layers: lys }) => {
      const placements = bin.placed.map(({ it, x, y, rot }) => ({
        name: it.name, layer: it.layer, key: it.key,
        l: it.l0, w: it.w0, x: +(x + edge).toFixed(2), y: +(y + edge).toFixed(2),
        rotation: rot ? 90 : 0,
      })).sort((a, b) => a.layer - b.layer || String(a.name).localeCompare(String(b.name)));
      return { layers: lys, placements,
        utilization: +(placements.reduce((a, p) => a + p.l * p.w, 0) / SHEET_AREA).toFixed(3) };
    }),
  };
}

// Repack ONE sheet's own parts into one bin, or say it cannot be done.
// This exists for the seam-nesting pass (Zac 2026-08-19: space the parts so
// the scrap comes off as small remnants between them, instead of packing
// tight and dicing one big field). That pass tries many arrangements of the
// SAME parts on the SAME sheet and keeps the one whose leftover salvages
// best and dices cheapest — so by construction it can never change the sheet
// count or which layers a sheet carries; only where the parts sit on it.
//
// Uses the same Bin, the same gap/edge inflation, the same rotations as
// nestByLayer — one packer, not a second copy of the rules that can drift.
// Returns placements in the nest's own shape, or null when this attempt
// could not seat every part (the caller just discards that attempt).
export function packSingleSheet(parts, opts = {}, { heur = 'bssf', seed = 1, jitter = 0 } = {}) {
  const { gap, edge, sheetL, sheetW } = { ...NEST_DEFAULTS, ...opts };
  const bin = new Bin(sheetL - 2 * edge + gap, sheetW - 2 * edge + gap);
  const rnd = mulberry(seed);
  let left = parts.map(p => ({ ...p, l0: p.l, w0: p.w, w: p.l + gap, h: p.w + gap }));
  while (left.length) {
    let pick = null;
    for (const it of left) {
      const b = bin.best(it, heur, rnd, jitter);
      if (b && (!pick || b.s < pick.b.s)) pick = { it, b };
    }
    if (!pick) return null;                    // an arrangement that drops a part is no arrangement
    bin.put(pick.b, pick.it);
    left = left.filter(i => i !== pick.it);
  }
  return bin.placed.map(({ it, x, y, rot }) => ({
    name: it.name, layer: it.layer, key: it.key,
    l: it.l0, w: it.w0, x: +(x + edge).toFixed(2), y: +(y + edge).toFixed(2),
    rotation: rot ? 90 : 0,
    ...(it.salvage ? { salvage: true, label: it.label } : {}),
  }));
}

// Geometry helpers the editor page shares, so "does this overlap?" is
// answered by the same code that placed the parts.
export function partBox(p) {
  const rot = ((p.rotation % 360) + 360) % 360, sw = rot === 90 || rot === 270;
  const w = sw ? p.w : p.l, h = sw ? p.l : p.w;
  return [p.x, p.x + w, p.y, p.y + h];
}
export function violates(p, others, gap) {
  const A = partBox(p);
  return others.some(o => {
    if (o === p) return false;
    const B = partBox(o);
    const dx = Math.max(B[0] - A[1], A[0] - B[1]), dy = Math.max(B[2] - A[3], A[2] - B[3]);
    return Math.max(dx, dy) < gap - 0.01;
  });
}

// ---- re-shuffle ONE sheet so the leftover is already small ------------------
// Zac 2026-08-20: "for each nest i hand-build i would like a button to have you
// re-shuffle the layout of the parts on that nest to create a natural cut-up of
// scrap into small-enough parts, based on the location of the parts (in a
// checkerboard pattern, etc, creating spaces between them that are small
// squares/rectangles)."
//
// The idea is the inverse of what dicing does. Dicing packs tight and then
// spends machine time sawing the leftover into carryable pieces; this arranges
// the SAME parts so the gaps are already the right size and most of that sawing
// never has to happen.
//
// It is a search, not a pattern. "Checkerboard" is the look you get when it
// works, not an instruction that can be followed literally — the parts are
// whatever the layer needs and rarely tile. So: pack the sheet many times with
// different heuristics and jitter, and keep the layout whose LEFTOVER costs the
// least to cut up. The cost function is the one the editor already shows the
// operator, so the button optimises exactly the number on screen.
//
// scoreSheet is injected rather than imported: nest.mjs must not depend on
// scrap.mjs (scrap.mjs already reads geometry from here, and a cycle between
// them would break the module graph in the browser).
export function shuffleForScrap(sheet, opts = {}, scoreSheet, { tries = 400 } = {}) {
  const parts = (sheet.placements || []).filter((p) => !p.salvage);
  const keep = (sheet.placements || []).filter((p) => p.salvage);
  if (parts.length < 2) return null;

  const base = scoreSheet({ ...sheet, placements: [...parts, ...keep] });
  let best = null;
  const HEUR = ['bssf', 'blsf', 'baf', 'bl'];
  for (let t = 0; t < tries; t++) {
    const r = packSingleSheet(parts, opts,
      { heur: HEUR[t % HEUR.length], seed: t * 2654435761 + 7, jitter: (t % 90) * 0.9 });
    // packSingleSheet returns the placement ARRAY, and it returns null rather
    // than dropping a part. Both matter: a layout missing a part is not a tidier
    // layout, it is a lost part.
    if (!r || r.length !== parts.length) continue;
    const cand = { ...sheet, placements: [...r, ...keep] };
    const s = scoreSheet(cand);
    if (!best || s.cost < best.score.cost) best = { placements: cand.placements, score: s };
  }
  if (!best || best.score.cost >= base.cost) return { improved: false, before: base, after: base };
  return { improved: true, before: base, after: best.score, placements: best.placements };
}
