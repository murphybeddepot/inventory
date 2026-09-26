// Shared dicing geometry used by the editor and native-post tooling.
const IN=25.4, EPS=0.003, CELL=2;
const fail=(ok,message)=>{if(!ok)throw Error(message);};
const near=(a,b)=>Math.abs(a-b)<=EPS;
const round=n=>Math.round(n*1000)/1000;
export class Raster {
  constructor(width, height) {
    this.width = width; this.height = height;
    this.nx = Math.ceil(width / CELL); this.ny = Math.ceil(height / CELL);
    this.material = new Uint8Array(this.nx * this.ny).fill(1);
  }
  clear(x0, y0, x1, y1, grid = this.material) {
    const i0 = Math.max(0, Math.floor(x0 / CELL)), i1 = Math.min(this.nx - 1, Math.ceil(x1 / CELL) - 1);
    const j0 = Math.max(0, Math.floor(y0 / CELL)), j1 = Math.min(this.ny - 1, Math.ceil(y1 / CELL) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[i + j * this.nx] = 0;
  }
  sweep(seg, r, grid = this.material) {
    const [x, y, a, b] = seg, q = r / Math.SQRT2;
    if (near(y, b)) this.clear(Math.min(x, a), y - r, Math.max(x, a), y + r, grid);
    else this.clear(x - r, Math.min(y, b), x + r, Math.max(y, b), grid);
    for (const [u, v] of [[x, y], [a, b]]) this.clear(u - q, v - q, u + q, v + q, grid);
  }
  /**
   * The material with every ribbon narrower than `width` removed: a cell
   * survives only if some width x width square of standing material covers
   * it (a morphological opening). Pockets are measured on THIS, so a sub-inch
   * rim running round the sheet cannot join every pocket into one island.
   * Done with a difference grid so it is linear in the cell count.
   */
  opened(grid, width) {
    const { nx, ny } = this, k = Math.max(1, Math.round(width / CELL));
    if (k <= 1) return grid.slice();
    const sat = new Int32Array((nx + 1) * (ny + 1));
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++)
      sat[i + j * (nx + 1)] = grid[(i - 1) + (j - 1) * nx] + sat[(i - 1) + j * (nx + 1)] + sat[i + (j - 1) * (nx + 1)] - sat[(i - 1) + (j - 1) * (nx + 1)];
    const diff = new Int32Array((nx + 1) * (ny + 1));
    for (let j = 0; j + k <= ny; j++) for (let i = 0; i + k <= nx; i++) {
      const full = sat[(i + k) + (j + k) * (nx + 1)] - sat[i + (j + k) * (nx + 1)] - sat[(i + k) + j * (nx + 1)] + sat[i + j * (nx + 1)];
      if (full !== k * k) continue;
      diff[i + j * (nx + 1)]++; diff[(i + k) + j * (nx + 1)]--; diff[i + (j + k) * (nx + 1)]--; diff[(i + k) + (j + k) * (nx + 1)]++;
    }
    const out = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      diff[i + j * (nx + 1)] += (i ? diff[(i - 1) + j * (nx + 1)] : 0) + (j ? diff[i + (j - 1) * (nx + 1)] : 0) - (i && j ? diff[(i - 1) + (j - 1) * (nx + 1)] : 0);
      out[i + j * nx] = diff[i + j * (nx + 1)] > 0 ? 1 : 0;
    }
    return out;
  }
  /** Connected islands of standing material, each with cells + box (mm). */
  islands(grid = this.material, only = null) {
    const { nx, ny } = this, seen = new Uint8Array(nx * ny), out = [], stack = [];
    for (let s = 0; s < grid.length; s++) {
      if (!grid[s] || seen[s] || (only && !only.has(s))) continue;
      let i0 = nx, i1 = -1, j0 = ny, j1 = -1;
      const cells = new Set(); stack.length = 0; stack.push(s); seen[s] = 1;
      while (stack.length) {
        const c = stack.pop(), i = c % nx, j = (c - i) / nx;
        cells.add(c);
        if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
        for (const n of [i > 0 ? c - 1 : -1, i + 1 < nx ? c + 1 : -1, j > 0 ? c - nx : -1, j + 1 < ny ? c + nx : -1])
          if (n >= 0 && grid[n] && !seen[n] && (!only || only.has(n))) { seen[n] = 1; stack.push(n); }
      }
      out.push({ cells, area: cells.size * CELL * CELL, box: [i0 * CELL, j0 * CELL, (i1 + 1) * CELL, (j1 + 1) * CELL] });
    }
    return out;
  }
}

// A piece's size as the bin sees it: its box plus the half-kerf fringe it
// keeps when the skin breaks, clamped to the sheet. [w, h] in mm.
const pieceSize = (box, r, width, height) => [
  Math.min(width, box[2] + r) - Math.max(0, box[0] - r),
  Math.min(height, box[3] + r) - Math.max(0, box[1] - r),
];

// ---------------------------------------------------------------------------
export function planScrap(post, {
  skin = 0.5, through = false, maxInches = 8, stripInches = null, ribbonInches = 1, narrowInches = 2,
  clearance = 6, sweep = 'auto',
} = {}) {
  fail(['auto', 'rows', 'columns'].includes(sweep), 'Sweep must be auto, rows or columns.');
  if (sweep === 'auto') {
    // Both decompositions, planned in full; the cheaper one is the plan.
    const a = planScrap(post, { skin, through, maxInches, stripInches, ribbonInches, narrowInches, clearance, sweep: 'rows' });
    let b = null;
    try { b = planScrap(post, { skin, through, maxInches, stripInches, ribbonInches, narrowInches, clearance, sweep: 'columns' }); } catch (e) { b = null; }
    if (!b) return a;
    const cost = (p) => p.plunges * 1000 + p.cutLength / 10 + p.rapid / 100;
    return cost(b) < cost(a) ? b : a;
  }
  fail(Number.isFinite(maxInches) && maxInches >= 3 && maxInches <= 24, 'Largest piece must be 3 to 24 inches.');
  if (!through) fail(Number.isFinite(skin) && skin >= 0.2 && skin <= 2, 'Skin must be 0.2 to 2 mm.');
  fail(Number.isFinite(clearance) && clearance >= 3 && clearance <= 25, 'Clearance must be 3 to 25 mm.');
  stripInches = stripInches ?? maxInches;
  fail(Number.isFinite(stripInches) && stripInches >= maxInches && stripInches <= 48, 'Strip length must be at least the piece size and at most 48 inches.');
  fail(Number.isFinite(ribbonInches) && ribbonInches >= 0 && ribbonInches <= 2, 'Ribbon width must be 0 to 2 inches.');
  fail(Number.isFinite(narrowInches) && narrowInches >= ribbonInches && narrowInches <= maxInches, 'Narrow width must be between the ribbon width and the piece size.');
  const { parts, radius: r, width, height } = post;
  const MAX = maxInches * IN, STRIP = stripInches * IN, RIBBON = ribbonInches * IN, NARROW = narrowInches * IN, MIN_PIECE = 4 * IN;
  fail(MAX >= 4 * r + 20, `${maxInches} inch pieces are too small to cut with a ${(2 * r).toFixed(1)} mm cutter.`);

  // --- the sheet as it stands after the native program ----------------------
  const raster = new Raster(width, height);
  for (const { box } of parts) raster.clear(box[0], box[1], box[2], box[3]);
  for (const seg of post.contours.flat()) raster.sweep(seg, r);
  const base = raster.material.slice();
  // Pockets are measured on the opened material: everything narrower than the
  // ribbon width is gone from the measurement (not from the sheet). What is
  // left of the ribbons hangs off the pieces as thin tails and is REPORTED.
  const baseCore = raster.opened(base, RIBBON);
  const keepouts = parts.map(({ box: [a, b, c, d] }) => [a - r - clearance, b - r - clearance, c + r + clearance, d + r + clearance]);

  // Where the cutter centre may run along a line, split around every keep-out.
  // axis 0: a vertical line at X=fixed spanning Y in [lo,hi]; axis 1: horizontal.
  const freeSpans = (axis, fixed, lo, hi) => {
    const length = axis === 0 ? height : width;
    let ranges = [[Math.max(-r, lo), Math.min(length + r, hi)]].filter(([a, b]) => b > a);
    for (const k of keepouts) {
      if (fixed < k[axis] - EPS || fixed > k[axis + 2] + EPS) continue;
      const a = k[1 - axis], b = k[3 - axis];
      ranges = ranges.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([u, v]) => v > u)));
    }
    return ranges.filter(([a, b]) => b - a >= 2 * r)     // shorter than the cutter is a plunge for nothing
      .map(([a, b]) => (axis === 0 ? [fixed, round(a), fixed, round(b)] : [round(a), fixed, round(b), fixed]));
  };

  // A piece is fine if both directions are under MAX — or, when it is a
  // narrow strip (under NARROW across), its length is under STRIP.
  const over = (box) => {
    const [w, h] = pieceSize(box, r, width, height);
    const across = Math.min(w, h), along = Math.max(w, h);
    if (across <= RIBBON) return false;                      // a ribbon: left whole, reported
    if (across < NARROW) return along > STRIP + CELL;
    return along > MAX + CELL;
  };

  // --- plan: rectangles first ------------------------------------------
  const cuts = [], seen = new Set();
  const add = (seg) => { const k = JSON.stringify(seg); if (seen.has(k)) return false; seen.add(k); cuts.push(seg); return true; };
  // Reach the cutter radius past the pocket so the kerf clears its edge —
  // and if only a ribbon separates the pocket from the sheet edge, run on
  // through to the edge so the rim is severed there instead of trailing off
  // the piece as a long tail.
  const reach = (axis, lo, hi) => {
    const edge = axis === 0 ? height : width;
    return [lo <= RIBBON + 2 * r ? -r : lo - r, hi >= edge - RIBBON - 2 * r ? edge + r : hi + r];
  };
  // Equal division: the fewest pieces under the limit, all the same size.
  // The box is measured on material only, so the fringe (r each side) sits
  // on top of it: pieces of (len/n - 2r) + 2r = len/n must be <= limit.
  const divide = (rect, axis, limit, extent) => {
    const lo = rect[axis], hi = rect[axis + 2], len = hi - lo;
    const n = Math.max(2, Math.ceil((len + 2 * r) / limit));
    let added = 0;
    for (let i = 1; i < n; i++) {
      const fixed = round(lo + (len * i) / n);
      const [plo, phi] = extent ? extent(fixed) : [rect[1 - axis], rect[3 - axis]];
      if (plo === null) continue;
      const [clo, chi] = reach(axis, plo, phi);
      for (const seg of freeSpans(axis, fixed, clo, chi)) if (add(seg)) added++;
    }
    return added;
  };
  for (const island of raster.islands(baseCore).filter((k) => k.area > 400)) {
    // A step smaller than an inch in a pocket's edge is not a seam worth a
    // plunge: the pieces on either side just differ by that much.
    const rects = decompose(island, raster, sweep === 'columns', Math.max(2 * r + 4, IN));
    // Seams: where two rectangles of one island touch, cut along the seam
    // over their overlap, so each rectangle becomes its own piece(s).
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const A = rects[i], B = rects[j];
      for (const axis of [0, 1]) {                       // 1: a horizontal seam at some Y; 0: a vertical seam at some X
        const c = 1 - axis;                               // the coordinate the seam sits on
        const touch = near(A[c + 2], B[c]) ? A[c + 2] : near(B[c + 2], A[c]) ? B[c + 2] : null;
        if (touch === null) continue;
        const lo = Math.max(A[axis], B[axis]), hi = Math.min(A[axis + 2], B[axis + 2]);
        if (hi - lo < 2 * r) continue;
        const [clo, chi] = reach(axis, lo, hi);
        for (const seg of freeSpans(axis, touch, clo, chi)) add(seg);
      }
    }
    for (const rect of rects) {
      const [w, h] = pieceSize(rect, r, width, height);
      const limit = Math.min(w, h) < NARROW ? STRIP : MAX;
      if (Math.max(w, h) <= limit) continue;
      // A strip is only ever cross-cut. A broad rectangle is cut across its
      // longer side here; the re-measure below adds the other way.
      divide(rect, w >= h ? 0 : 1, limit, null);
    }
  }
  // --- then: anything still over is split by its box, re-measured, repeated
  const tried = new Set();
  let rounds = 0;
  for (; rounds < 16; rounds++) {
    const grid = baseCore.slice();
    for (const c of cuts) raster.sweep(c, r, grid);
    const pockets = raster.islands(grid).filter((k) => k.area > 400 && over(k.box));
    if (!pockets.length) break;
    let added = 0;
    for (const k of pockets) {
      const [w, h] = pieceSize(k.box, r, width, height);
      const limit = Math.min(w, h) < NARROW ? STRIP : MAX;
      // Across the longer side — and if that did not separate it (an L keeps
      // its box), the other way next.
      let axis = w >= h ? 0 : 1;
      const key = JSON.stringify(k.box);
      if (tried.has(key + axis)) axis = 1 - axis;
      if (tried.has(key + axis)) continue;
      tried.add(key + axis);
      // Only as far as THIS pocket reaches at each coordinate.
      added += divide(k.box, axis, limit, (fixed) => pocketExtent(k, axis, fixed, raster));
    }
    if (!added) break;
  }

  // --- drop cuts that separate nothing -----------------------------------
  // Each pocket was divided on its own, so two pockets can plant a cut on
  // the same coordinate, or a later round can make an earlier cut redundant.
  // Take each away; if every piece is still within its limit, it was not
  // doing anything. Also the honest answer to "cuts are excessive".
  const measure = (list) => {
    const grid = baseCore.slice();
    for (const c of list) raster.sweep(c, r, grid);
    return raster.islands(grid).filter((k) => k.area > 400);
  };
  const allWithin = (list) => measure(list).every((k) => !over(k.box));
  for (let i = cuts.length - 1; i >= 0; i--) {
    const without = cuts.slice(0, i).concat(cuts.slice(i + 1));
    if (allWithin(without)) cuts.splice(i, 1);
  }
  // Collinear cuts that touch, or nearly touch across a kerf, are one line.
  mergeTouching(cuts, 2 * r + 2 * CELL);

  // --- the verdict, from the pieces the cuts actually leave ----------------
  const pieces = measure(cuts);
  const bad = pieces.filter((k) => over(k.box));
  const describe = (k) => { const [w, h] = pieceSize(k.box, r, width, height); return `${(w / IN).toFixed(1)}x${(h / IN).toFixed(1)}in at X${Math.round(k.box[0])} Y${Math.round(k.box[1])}`; };
  fail(bad.length === 0, `${bad.length} piece(s) still over ${maxInches} in after ${rounds} round(s); nothing written. `
    + `Largest: ${bad.slice(0, 4).map(describe).join(', ')}. A pocket the cutter cannot enter (narrower than ${(2 * r + 2 * clearance).toFixed(0)} mm between parts) needs a larger size or a smaller stand-off.`);
  fail(cuts.length > 0, 'Nothing to cut: every piece of waste is already within the limit.');

  // --- the safety gate on the emitted geometry ------------------------------
  // Not the intent: the segments themselves, swept by the cutter, against
  // every part. This is what the machine will do.
  let minClearance = Infinity;
  for (const s of cuts) for (const { box } of parts) {
    const sx0 = Math.min(s[0], s[2]) - r, sx1 = Math.max(s[0], s[2]) + r, sy0 = Math.min(s[1], s[3]) - r, sy1 = Math.max(s[1], s[3]) + r;
    const gap = Math.max(box[0] - sx1, sx0 - box[2], box[1] - sy1, sy0 - box[3]);
    minClearance = Math.min(minClearance, gap);
  }
  fail(minClearance >= clearance - EPS, `A scrap cut comes within ${minClearance.toFixed(2)} mm of a part; refusing.`);

  // --- order the cuts for the head --------------------------------------
  const ordered = orderForTravel(cuts, [0, 0]);
  const cutLength = ordered.reduce((t, s) => t + Math.hypot(s[2] - s[0], s[3] - s[1]), 0);
  const rapid = rapidTravel(ordered, [0, 0]);
  const unorderedRapid = rapidTravel(cuts, [0, 0]);

  const sizes = pieces.map((k) => pieceSize(k.box, r, width, height));
  // The ribbons: standing material the opening removed, after our cuts.
  const ribbons = (() => {
    const full = base.slice(), core = baseCore.slice();
    for (const c of cuts) { raster.sweep(c, r, full); raster.sweep(c, r, core); }
    for (let i = 0; i < full.length; i++) if (core[i]) full[i] = 0;
    return raster.islands(full).filter((k) => k.area > 400).map((k) => { const [w, h] = pieceSize(k.box, r, width, height); return { w: +(w / IN).toFixed(1), h: +(h / IN).toFixed(1), box: k.box }; });
  })();
  const small = sizes.filter(([w, h]) => Math.min(w, h) < MIN_PIECE).length;
  return {
    lines: ordered, skin: through ? null : skin, through, maxInches, stripInches, ribbonInches, narrowInches, clearance, sweep, rounds,
    pieces: pieces.map((k) => ({ box: k.box, size: pieceSize(k.box, r, width, height) })),
    pieceCount: sizes.length, ribbons,
    largestIn: +(Math.max(0, ...sizes.map(([w, h]) => Math.max(w, h))) / IN).toFixed(2),
    smallestIn: sizes.length ? +(Math.min(...sizes.map(([w, h]) => Math.min(w, h))) / IN).toFixed(2) : null,
    smallCount: small,
    plunges: ordered.length, cutLength, rapid, unorderedRapid, minClearance,
  };
}

/**
 * Break an island into rectangles by sweeping it row by row (or column by
 * column when `columns`): a run of cells continues the rectangle above it
 * when both ends sit within `tol` of that rectangle's ends, otherwise a new
 * rectangle starts. A step smaller than the cutter cannot be a seam, so
 * `tol` is the kerf plus a little. Returns [x0,y0,x1,y1] boxes in mm.
 */
export function decompose(island, raster, columns, tol) {
  const { nx } = raster;
  const lines = new Map();
  for (const c of island.cells) {
    const i = c % nx, j = (c - i) / nx;
    const line = columns ? i : j, along = columns ? j : i;
    (lines.get(line) || lines.set(line, []).get(line)).push(along);
  }
  const order = [...lines.keys()].sort((a, b) => a - b);
  let open = [];
  const done = [];
  let prev = null;
  for (const line of order) {
    if (prev !== null && line !== prev + 1) { done.push(...open); open = []; }   // a gap: nothing continues
    prev = line;
    const cells = lines.get(line).sort((a, b) => a - b);
    const runs = [];
    for (const a of cells) { const last = runs[runs.length - 1]; if (last && a === last[1] + 1) last[1] = a; else runs.push([a, a]); }
    const matched = new Set(), next = [];
    for (const [a, b] of runs) {
      const lo = a * CELL, hi = (b + 1) * CELL;
      const idx = open.findIndex((o, k) => !matched.has(k) && Math.abs(o.lo - lo) <= tol && Math.abs(o.hi - hi) <= tol);
      if (idx >= 0) { matched.add(idx); const o = open[idx]; o.lo = Math.min(o.lo, lo); o.hi = Math.max(o.hi, hi); o.end = line; next.push(o); }
      else next.push({ lo, hi, start: line, end: line });
    }
    for (const [k, o] of open.entries()) if (!matched.has(k)) done.push(o);
    open = next;
  }
  done.push(...open);
  const rects = done.map((o) => (columns ? [o.start * CELL, o.lo, (o.end + 1) * CELL, o.hi] : [o.lo, o.start * CELL, o.hi, (o.end + 1) * CELL]));
  // A rectangle thinner than the tolerance in the sweep direction is a bump
  // on its neighbour, not a piece: absorb it into the touching rectangle it
  // shares the most edge with, so no seam (and no plunge) is spent on it.
  const t = columns ? 0 : 1;                                     // the sweep axis
  for (let guard = 0; guard < rects.length * 2; guard++) {
    const thin = rects.findIndex((q) => q[t + 2] - q[t] < tol && rects.length > 1);
    if (thin < 0) break;
    const q = rects[thin];
    let best = -1, bestOverlap = 0;
    for (let k = 0; k < rects.length; k++) {
      if (k === thin) continue;
      const o = rects[k];
      const touches = near(o[t + 2], q[t]) || near(q[t + 2], o[t]);
      const overlap = Math.min(o[3 - t], q[3 - t]) - Math.max(o[1 - t], q[1 - t]);
      if (touches && overlap > bestOverlap) { best = k; bestOverlap = overlap; }
    }
    if (best < 0) break;
    const o = rects[best];
    rects[best] = [Math.min(o[0], q[0]), Math.min(o[1], q[1]), Math.max(o[2], q[2]), Math.max(o[3], q[3])];
    rects.splice(thin, 1);
  }
  return rects;
}

/** The pocket's own extent along a cut at `fixed` (perpendicular to `axis`). */
function pocketExtent(k, axis, fixed, raster) {
  const i = Math.min(raster.nx - 1, Math.max(0, Math.floor(fixed / CELL)));
  let lo = Infinity, hi = -Infinity;
  for (const c of k.cells) {
    const ci = c % raster.nx, cj = (c - ci) / raster.nx;
    if ((axis === 0 ? ci : cj) !== i) continue;
    const t = axis === 0 ? cj : ci;
    if (t < lo) lo = t; if (t > hi) hi = t;
  }
  if (lo === Infinity) return [null, null];
  return [lo * CELL, (hi + 1) * CELL];
}

// Collinear cuts that touch, or miss each other by no more than a cutter
// width, are one line. The gap between two rows' cross-cuts is the kerf of
// the horizontal cut between them (already removed) plus the raster's
// rounding; a part could never sit in it, because a part's keep-out is a
// cutter plus two stand-offs wide. Joined lines are still checked against
// every part by the safety gate below.
function mergeTouching(cuts, join = 0) {
  const groups = new Map();
  for (const s of cuts) { const v = near(s[0], s[2]); const k = (v ? 'x' : 'y') + (v ? s[0] : s[1]); (groups.get(k) || groups.set(k, []).get(k)).push(s); }
  cuts.length = 0;
  for (const g of groups.values()) {
    const v = near(g[0][0], g[0][2]), i = v ? 1 : 0, fixed = v ? g[0][0] : g[0][1];
    g.sort((a, b) => Math.min(a[i], a[i + 2]) - Math.min(b[i], b[i + 2]));
    let cur = null;
    const flush = () => { if (cur) cuts.push(v ? [fixed, cur[0], fixed, cur[1]] : [cur[0], fixed, cur[1], fixed]); };
    for (const s of g) {
      const lo = Math.min(s[i], s[i + 2]), hi = Math.max(s[i], s[i + 2]);
      if (cur && lo <= cur[1] + join + EPS) cur[1] = Math.max(cur[1], hi); else { flush(); cur = [lo, hi]; }
    }
    flush();
  }
}

/** Nearest-next ordering, each line run from whichever end is closer. */
export function orderForTravel(cuts, start) {
  const left = cuts.map((s) => s.slice());
  const out = [];
  let at = start;
  while (left.length) {
    let best = 0, bestD = Infinity, flip = false;
    for (let i = 0; i < left.length; i++) {
      const s = left[i];
      const d0 = Math.hypot(s[0] - at[0], s[1] - at[1]), d1 = Math.hypot(s[2] - at[0], s[3] - at[1]);
      if (d0 < bestD) { bestD = d0; best = i; flip = false; }
      if (d1 < bestD) { bestD = d1; best = i; flip = true; }
    }
    const s = left.splice(best, 1)[0];
    const seg = flip ? [s[2], s[3], s[0], s[1]] : s;
    out.push(seg); at = [seg[2], seg[3]];
  }
  return out;
}
export function rapidTravel(cuts, start) {
  let at = start, t = 0;
  for (const s of cuts) { t += Math.hypot(s[0] - at[0], s[1] - at[1]); at = [s[2], s[3]]; }
  return t;
}

// ---------------------------------------------------------------------------
