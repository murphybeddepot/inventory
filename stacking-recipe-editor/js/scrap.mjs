// scrap.mjs — what to do with the sheet AFTER the job's parts are placed.
//
// Zac 2026-08-18: "can your nest editor now cut the rest of the scrap into
// either known crate parts or less-than-12x12 sections to roll into the scrap
// bin?"
//
// Two passes over the leftover area:
//   1. SALVAGE — fit parts from a catalogue (crate panels by default) into the
//      free space. These are real parts and get cut with the job.
//   2. DICE — whatever is still empty is split into pieces no longer than
//      ~12in on either side, so the offcut comes off in pieces a person can
//      carry instead of one sheet-sized skeleton.
//
// The 11.9in default matches scripts/cut-scrap.mjs, which is what actually
// emits the dicing G-code on the posted nest (proven on real sheets since
// 2026-08-06). Same number in both places on purpose — this planner shows what
// that pass will do, it does not replace it.

import { CRATE_PARTS, CRATE_BY_KEY } from './crate_parts.mjs?v=3.83';

export const IN = 25.4;
export const DEFAULT_MAX_PIECE_IN = 11.9;

// Crate panels. The catalogue is a STANDING library of every crate size we
// build (12 / 14.25 / 19.5in), frozen into crate_parts.mjs from the three
// proven library products -- so any job can recover any crate panel from its
// leftover. Zac 2026-08-25: "every job should be free to place all 3 crate
// size's parts... it's just for using up scrap with crate parts, not crate
// parts specific to the job being created."
//
// Crates ARE cut from 19mm melamine (Zac 2026-08-18), so salvaging these off
// an offcut is straight material recovery -- the same sheet either way.
//
// qty is how many of that panel you want IN TOTAL across the job, not per
// sheet: filling scrap sheet by sheet against a fresh budget quietly produced
// a crate's worth per sheet.
//
// `src` is the link back to a crate_parts entry, and it is what makes a
// salvaged panel come off the machine DRILLED. Without it the exporter has
// only a rectangle to write, which is exactly how every crate part Zac has
// nested so far got cut blind (2026-08-24). Hand-added rows have no src and
// still work -- they are just cut to size, same as before.
const CAT_KEY = 'mbd_scrap_catalog_v2';
const CAT_KEY_V1 = 'mbd_scrap_catalog_v1';
export function loadCatalog() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAT_KEY) || 'null');
    if (Array.isArray(raw) && raw.length) return raw.map(normalizeCat);
  } catch (e) { /* defaults */ }
  // A v1 catalogue is a list of bare rectangles the user tuned by hand. Carry
  // their QUANTITIES onto the linked panels rather than throwing the tuning
  // away, and keep any row that is not a crate panel as-is.
  try {
    const v1 = JSON.parse(localStorage.getItem(CAT_KEY_V1) || 'null');
    if (Array.isArray(v1) && v1.length) return mergeLegacyCatalog(v1).map(normalizeCat);
  } catch (e) { /* defaults */ }
  return DEFAULT_CATALOG.map(normalizeCat);
}
export function saveCatalog(list) {
  const clean = (list || []).filter(c => c && c.name).map(normalizeCat);
  localStorage.setItem(CAT_KEY, JSON.stringify(clean));
  return clean;
}
export function normalizeCat(c) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  const name = String(c.name || 'PART');
  const src = String(c.src || '');
  const linked = src && CRATE_BY_KEY.get(src);
  const out = { key: String(c.key || src || name), name, label: String(c.label || name),
    l: n(c.l, 100), w: n(c.w, 100), qty: Math.max(0, Math.floor(Number(c.qty) || 0)), src };
  // A linked row's geometry is the PRODUCT's, never the stored copy: the .opt
  // part must carry the same L/W as the .moz outline or Mozaik rescales every
  // operation on it. Editing those numbers by hand is not a thing you can do.
  if (linked) { out.l = linked.L; out.w = linked.W; out.name = linked.code; }
  return out;
}
// v1 -> v2. Old rows were BOT/TOP/S1/E1 sized for whichever crate was current.
function mergeLegacyCatalog(v1) {
  const out = DEFAULT_CATALOG.map(c => ({ ...c }));
  const extra = [];
  for (const row of v1) {
    const hit = matchCratePart(row.name, row.l, row.w);
    const dst = hit && out.find(c => c.key === hit.key);
    if (dst) { dst.qty = Math.max(0, Math.floor(Number(row.qty) || 0)); continue; }
    extra.push(row);
  }
  return out.concat(extra);
}

// How many of each catalogue part are ALREADY salvaged anywhere in the nest.
// Keyed on the catalogue KEY, not the name: three crate sides are all called
// "S1" upstream, and bucketing them together made two of the three invisible
// to the budget.
export function salvagedSoFar(sheets) {
  const t = {};
  for (const s of sheets || []) for (const p of (s.placements || [])) {
    if (!p.salvage) continue;
    const k = p.src || p.name;
    t[k] = (t[k] || 0) + 1;
  }
  return t;
}
// The budget key of a catalogue row. Derived rather than required, so a
// hand-built catalogue ({name,l,w,qty} and nothing else) still budgets
// correctly instead of bucketing every row under `undefined`.
export const catKey = (c) => String((c && (c.key || c.src || c.name)) || '');
export function remainingBudget(sheets, catalog) {
  const have = salvagedSoFar(sheets);
  const left = {};
  for (const c of catalog) left[catKey(c)] = Math.max(0, c.qty - (have[catKey(c)] || 0));
  return left;
}

export const DEFAULT_CATALOG = CRATE_PARTS.map(p => ({
  key: p.key, name: p.code, label: p.label, l: p.L, w: p.W, qty: p.defaultQty, src: p.key,
}));

// Find the crate panel a loose rectangle IS. Dimensions are compared
// UNORDERED because the old catalogue stored the crate end transposed
// (1066.8 x 495.3 where the product says 495.3 x 1066.8), and a nest full of
// those is the nest Zac has on his machine right now.
export function matchCratePart(name, l, w) {
  const code = String(name || '').trim().toUpperCase();
  const d = [Math.round(l), Math.round(w)].sort((a, b) => a - b);
  const fits = (p) => {
    const pd = [Math.round(p.L), Math.round(p.W)].sort((a, b) => a - b);
    return Math.abs(pd[0] - d[0]) <= 1 && Math.abs(pd[1] - d[1]) <= 1;
  };
  // exact code first, then code family (old "S1" against S1-12/S1-14/S1-19),
  // then dimensions alone -- each step only accepts an UNAMBIGUOUS answer.
  const exact = CRATE_PARTS.filter(p => p.code.toUpperCase() === code && fits(p));
  if (exact.length === 1) return exact[0];
  const fam = CRATE_PARTS.filter(p => p.code.toUpperCase().split('-')[0] === code.split('-')[0] && fits(p));
  if (fam.length === 1) return fam[0];
  const any = CRATE_PARTS.filter(fits);
  return any.length === 1 ? any[0] : null;
}

// Attach crate records to salvage placements that predate the link, IN PLACE.
// Old nests carry bare rectangles; this is what turns them into drilled parts
// without asking the user to re-nest and lose their manual moves.
// Returns {linked, unlinked, changed} -- unlinked rows are reported, never
// silently left to export as blanks.
export function relinkSalvage(sheets) {
  const res = { linked: 0, unlinked: [], changed: false };
  for (const s of sheets || []) for (const p of (s.placements || [])) {
    if (!p.salvage) continue;
    if (p.src && CRATE_BY_KEY.has(p.src)) { res.linked++; continue; }
    const hit = matchCratePart(p.name, p.l, p.w);
    if (!hit) { res.unlinked.push(p.name); continue; }
    // The panel's L/W is the product's. If the stored rectangle was
    // transposed, rotate the placement by the same 90 so the footprint on the
    // sheet does not move a millimetre.
    if (Math.round(p.l) !== Math.round(hit.L) || Math.round(p.w) !== Math.round(hit.W)) {
      p.rotation = (((p.rotation || 0) + 90) % 360);
    }
    p.src = hit.key; p.name = hit.code; p.label = hit.label;
    p.l = hit.L; p.w = hit.W;
    res.linked++; res.changed = true;
  }
  return res;
}

const box = (p) => {
  const rot = ((p.rotation % 360) + 360) % 360, sw = rot === 90 || rot === 270;
  const w = sw ? p.w : p.l, h = sw ? p.l : p.w;
  return [p.x, p.x + w, p.y, p.y + h];
};

// Free space as a grid of maximal-ish rectangles: sweep the sheet on the X
// boundaries of what is already placed, then collapse vertical gaps per band.
// Not the theoretical maximal-rectangle set — this is deliberately the simple,
// checkable version, and every candidate is verified against every placement
// before it is used.
// The narrow-strip floor. A free rectangle thinner than this on EITHER side is
// left whole instead of being diced: the 16mm corridors between parts are
// chips, not scrap, and dicing them was the bulk of the "massively excessive
// number of cuts" Zac saw. It is a default, not a law — the nest screen
// exposes it, and shows what it skipped, because a silently-uncut strip looks
// like a bug (Zac 2026-08-18: "why is the long strip above 1E ... not cut up
// at all?" — it was a 78in x 3.2in strip one millimetre under the floor).
export const DEFAULT_MIN_DIM_MM = 100;

export function freeRects(sheet, { sheetL, sheetW, edge = 3, gap = 16, minDimMM = DEFAULT_MIN_DIM_MM }) {
  const parts = (sheet.placements || []).map(box);
  const xs = new Set([edge, sheetL - edge]);
  for (const [x0, x1] of parts) {
    if (x0 - gap > edge) xs.add(+(x0 - gap).toFixed(2));
    if (x1 + gap < sheetL - edge) xs.add(+(x1 + gap).toFixed(2));
  }
  const cols = [...xs].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const cx0 = cols[i], cx1 = cols[i + 1];
    if (cx1 - cx0 < 1) continue;
    // parts overlapping this column band, inflated by the gap
    const blocked = parts
      .filter(([x0, x1]) => x1 + gap > cx0 && x0 - gap < cx1)
      .map(([, , y0, y1]) => [y0 - gap, y1 + gap])
      .sort((a, b) => a[0] - b[0]);
    let y = edge;
    for (const [b0, b1] of blocked) {
      if (b0 > y) out.push({ x: cx0, y, w: cx1 - cx0, h: b0 - y });
      y = Math.max(y, b1);
    }
    if (y < sheetW - edge) out.push({ x: cx0, y, w: cx1 - cx0, h: sheetW - edge - y });
  }
  // MERGE adjacent bands that share a vertical extent. The sweep puts a column
  // boundary at every part edge, so one clear strip came out as ten narrow
  // cells and diced into ten pieces (Zac: "massively excessive number of
  // cuts"). Merging restores it to the single rectangle it actually is.
  const merged = [];
  for (const r of out.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.y - r.y) < 0.5 && Math.abs(prev.h - r.h) < 0.5
        && Math.abs(prev.x + prev.w - r.x) < 0.5) {
      prev.w += r.w;                       // same band, touching — one rectangle
    } else merged.push({ ...r });
  }
  // A sliver is waste, not scrap: the 16mm corridors between parts are chips.
  // Anything under minDim on either side is left alone rather than cut up.
  const MIN_DIM = minDimMM;
  return merged
    .filter(r => r.w >= MIN_DIM && r.h >= MIN_DIM)
    .map(r => ({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) }));
}

// What the floor threw away — the strips on the drawing that carry no dice.
// Corridor chips are excluded (short side under 25mm, or under 0.02 m2) so the
// overlay shows real leftover material and not the gaps between parts.
export function skippedStrips(sheet, opts, minDimMM = DEFAULT_MIN_DIM_MM) {
  const kept = freeRects(sheet, { ...opts, minDimMM });
  const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  return freeRects(sheet, { ...opts, minDimMM: 0 })
    .filter(r => !kept.some(k => same(k, r)))
    .filter(r => Math.min(r.w, r.h) >= 25 && r.w * r.h >= 20000);
}

function fitsClear(cand, placements, gap) {
  const A = [cand.x, cand.x + cand.w, cand.y, cand.y + cand.h];
  return !placements.some(p => {
    const B = box(p);
    const dx = Math.max(B[0] - A[1], A[0] - B[1]), dy = Math.max(B[2] - A[3], A[2] - B[3]);
    return Math.max(dx, dy) < gap - 0.01;
  });
}

// Greedy: biggest catalogue part first, anchored at free-rect corners. A
// candidate may EXTEND past the free rect it is anchored in: the free-space
// model is a banded sweep, so one clear strip above three parts reads as
// three same-height cells, and requiring containment in a single cell meant
// a 2032mm crate side could never be salvaged from space that is physically
// clear (found 2026-08-19 by the seam-nest tests — the Fill scrap button had
// the same blindness). The containment check that matters is explicit
// instead: inside the sheet trim, and gap-clear of every real placement.
export function fitSalvage(sheet, opts, catalog = DEFAULT_CATALOG, budget = null) {
  const { gap = 16, edge = 3, sheetL = 2770, sheetW = 1550 } = opts;
  const placed = [...(sheet.placements || [])];
  const got = [];
  const left = catalog.map(c => ({ ...c, remaining: budget ? (budget[catKey(c)] ?? c.qty) : c.qty }))
    .filter(c => c.remaining > 0)
    .sort((a, b) => b.l * b.w - a.l * a.w);
  let progress = true;
  while (progress) {
    progress = false;
    const frees = freeRects({ placements: placed }, opts).sort((a, b) => b.w * b.h - a.w * a.h);
    for (const c of left) {
      if (c.remaining <= 0) continue;
      for (const fr of frees) {
        for (const rot of [0, 90]) {
          const w = rot ? c.w : c.l, h = rot ? c.l : c.w;
          if (fr.x + w > sheetL - edge + 0.01 || fr.y + h > sheetW - edge + 0.01) continue;
          const cand = { x: fr.x, y: fr.y, w, h };
          if (!fitsClear(cand, placed, gap)) continue;
          const pl = { name: c.name, label: c.label, layer: 0, salvage: true,
            ...(c.src ? { src: c.src } : {}),
            l: c.l, w: c.w, x: +fr.x.toFixed(2), y: +fr.y.toFixed(2), rotation: rot };
          placed.push(pl); got.push(pl); c.remaining--; progress = true;
          break;
        }
        if (progress) break;
      }
      if (progress) break;
    }
  }
  return got;
}

// One decision, made in one place: which free fields get DICED and which
// stay WHOLE. dicePlan and plannedRemnants are two views of this same split —
// factoring it out is what stops "the .opt says remnant, the machine dices
// it" from ever being possible, because both read the same verdict.
export function classifyFields(sheet, opts, maxPieceIn = DEFAULT_MAX_PIECE_IN, minAreaIn2 = 0) {
  const MAX = maxPieceIn * IN;
  const MIN_AREA = minAreaIn2 * IN * IN;
  const dice = [], keep = [];
  for (const fr of freeRects(sheet, opts)) {
    if ((fr.w <= MAX && fr.h <= MAX)             // already bin-sized
      || (MIN_AREA && fr.w * fr.h < MIN_AREA)) { // too small to bother cutting
      keep.push(fr);
    } else dice.push(fr);
  }
  return { dice, keep };
}

// Everything still empty, split so no piece exceeds maxPiece on either side.
// minAreaIn2: leave small offcuts alone. A piece already smaller than the bin
// limit does not need cutting up, and every cut is machine time (Zac
// 2026-08-18: "the scrap dicing is going to add a whole bunch of time").
// How BAD is the leftover on this sheet, for the tidy-scrap search.
//
// The first version scored on metres of cutting, and Zac's screenshot showed
// exactly why that is the wrong objective: it packed all twelve 7A offcuts
// tight into one corner and left a single enormous void, because one big
// untouched rectangle costs no cutting at all. What he actually wants is the
// opposite — "more spaces between especially the 7a parts, creating a bunch of
// small-ish scrap parts". His Mozaik example spreads them out.
//
// So the cost is the AREA of leftover that is still too big to be useful. A
// free rectangle already at or under maxPiece on both sides is a finished
// offcut and costs nothing; anything larger is charged for its whole area,
// which is what makes the search push parts apart rather than herd them.
// Cutting length is kept only as a tiebreak between layouts that are equally
// good at that.
export function scrapPenalty(sheet, opts, maxPieceIn = DEFAULT_MAX_PIECE_IN) {
  const MAX = maxPieceIn * IN;
  let oversize = 0, ready = 0;
  for (const r of freeRects(sheet, opts)) {
    if (r.w <= MAX && r.h <= MAX) { ready += r.w * r.h; continue; }
    oversize += r.w * r.h;
  }
  const cut = diceCost(dicePlan(sheet, opts, maxPieceIn, 0));
  return {
    oversizeM2: +(oversize / 1e6).toFixed(3),   // what the search minimises
    readyM2: +(ready / 1e6).toFixed(3),         // leftover already usable as-is
    metres: cut.metres, pieces: cut.pieces, seconds: cut.seconds,
    // one number, so the caller cannot accidentally weight it differently:
    // oversize area dominates, cutting metres only separates ties
    cost: oversize / 1e6 + cut.metres / 1000,
  };
}

export function dicePlan(sheet, opts, maxPieceIn = DEFAULT_MAX_PIECE_IN, minAreaIn2 = 0) {
  const MAX = maxPieceIn * IN;
  const out = [];
  for (const fr of classifyFields(sheet, opts, maxPieceIn, minAreaIn2).dice) {
    const nx = Math.max(1, Math.ceil(fr.w / MAX)), ny = Math.max(1, Math.ceil(fr.h / MAX));
    const cw = fr.w / nx, ch = fr.h / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      out.push({ x: +(fr.x + i * cw).toFixed(2), y: +(fr.y + j * ch).toFixed(2),
        w: +cw.toFixed(2), h: +ch.toFixed(2) });
    }
  }
  return out;
}

// The fields the dice deliberately leaves whole — those ARE the sheet's
// usable remnants, and the .opt has a first-class record for exactly that
// (OptimizeRemnantLocation), so Mozaik can show and re-use them instead of
// them existing only as an absence of dice lines. Same verdict as dicePlan
// by construction.
export function plannedRemnants(sheet, opts, maxPieceIn = DEFAULT_MAX_PIECE_IN, minAreaIn2 = 0) {
  return classifyFields(sheet, opts, maxPieceIn, minAreaIn2).keep;
}

// What the dicing costs at the machine. Feed rates are the ones the posted
// NC actually uses on this router: F22800 cutting, F5000 plunging.
export function diceCost(dice, { feed = 22800, plunge = 5000, thickness = 19.05 } = {}) {
  let len = 0; const seen = new Set();
  for (const d of dice) {
    const edges = [
      ['h', d.y, d.x, d.w], ['h', +(d.y + d.h).toFixed(1), d.x, d.w],
      ['v', d.x, d.y, d.h], ['v', +(d.x + d.w).toFixed(1), d.y, d.h],
    ];
    for (const [ax, a, b, l] of edges) {
      const k = `${ax}:${a}:${b}:${l}`;
      if (seen.has(k)) continue;
      seen.add(k); len += l;
    }
  }
  const seconds = (len / feed) * 60 + dice.length * (thickness / plunge) * 60;
  return { metres: len / 1000, seconds: Math.round(seconds), pieces: dice.length };
}

// ---- seam nesting: shape the scrap instead of dicing it ---------------------
// Zac 2026-08-19: "what if the parts themselves were spaced as optimally as
// possible to create most of the scrap cuts as small remnants between the
// parts instead of grouping all the parts together then having to dice up
// larger remnants."
//
// The version built here is cluster-and-seam, not uniform spreading: for each
// sheet, try many arrangements of that sheet's OWN parts (packSingleSheet —
// the same packer, different orderings), salvage catalogue panels into each
// arrangement, and keep the arrangement whose leftover salvages the most and
// then dices the cheapest at the user's current dice settings. The current
// arrangement is always candidate zero, so the result is never worse than
// doing nothing — and because every candidate is the same parts on the same
// sheet, the pass CANNOT change the sheet count or which layers a sheet
// carries. Sheet count > layer order > seams, by construction rather than by
// policy.
//
// Machine-time honesty: pass-counting says a seam is roughly a wash (its two
// borders each need a freeing pass where one shared corridor freed both, but
// it deletes a dice rip of the same length). The win this optimizes for is
// scrap QUALITY — catalogue panels seated, leftover pre-sized so the dice has
// little to do, fields that stay whole recorded as real remnants.
//
// packOne is injected (the page passes packSingleSheet from nest.mjs) so this
// module keeps zero imports and stays testable in isolation.
export function shapeScrap(nest, opts, packOne, {
  catalog = DEFAULT_CATALOG, maxPieceIn = DEFAULT_MAX_PIECE_IN, minAreaIn2 = 0,
  attempts = 60,
} = {}) {
  // The budget starts at the full catalogue quantities: salvage is re-derived
  // on every sheet this pass touches, so nothing pre-existing counts against
  // it. Each sheet's winner consumes as it lands, which is what keeps "2
  // sides" meaning two across the whole nest.
  const budget = {};
  for (const c of catalog) budget[catKey(c)] = c.qty;
  const report = [];
  const salvArea = (pls) => pls.filter(p => p.salvage).reduce((a, p) => a + p.l * p.w, 0);

  for (const sheet of nest.sheets) {
    const real = (sheet.placements || []).filter(p => !p.salvage);
    if (!real.length) { report.push(null); continue; }

    // Candidate zero is the sheet exactly as it stands (its old salvage
    // dropped — salvage is re-derived per candidate against the live budget).
    // Every OTHER candidate must carry exactly the same parts: an arrangement
    // that lost one would WIN this scoring (fewer parts = more salvage, less
    // dicing), so a packer bug would silently delete a part from the nest.
    // Refused here, at the seam, rather than trusted to the packer.
    const want = real.map(p => `${p.name}|${p.l}x${p.w}`).sort().join(',');
    const complete = (arr) => Array.isArray(arr)
      && arr.map(p => `${p.name}|${p.l}x${p.w}`).sort().join(',') === want;
    const candidates = [real.map(p => ({ ...p }))];
    for (let t = 0; t < attempts; t++) {
      const heur = ['bssf', 'blsf', 'baf', 'bl'][t % 4];
      const arr = packOne(real, opts, { heur, seed: t * 2654435761 + 7, jitter: t < 4 ? 0 : (t % 30) * 2.5 });
      if (complete(arr)) candidates.push(arr);
    }

    let best = null;
    for (const cand of candidates) {
      const salv = fitSalvage({ placements: cand }, opts, catalog, budget);
      const full = [...cand, ...salv];
      const cost = diceCost(dicePlan({ placements: full }, opts, maxPieceIn, minAreaIn2));
      const sa = salvArea(full);
      if (!best || sa > best.sa + 0.5
        || (Math.abs(sa - best.sa) <= 0.5 && (cost.metres < best.cost.metres - 1e-9
          || (Math.abs(cost.metres - best.cost.metres) <= 1e-9 && cost.pieces < best.cost.pieces)))) {
        best = { full, salv, cost, sa };
      }
    }

    // the baseline the winner is judged against: candidate zero, same rules
    const baseSalv = fitSalvage({ placements: candidates[0] }, opts, catalog, budget);
    const before = diceCost(dicePlan({ placements: [...candidates[0], ...baseSalv] }, opts, maxPieceIn, minAreaIn2));

    sheet.placements = best.full;
    for (const s of best.salv) { const k = s.src || s.name; budget[k] = Math.max(0, (budget[k] || 0) - 1); }
    report.push({ salvaged: best.salv.length, before, after: best.cost });
  }
  return report;
}

export function scrapSummary(sheet, opts, dice) {
  const A = opts.sheetL * opts.sheetW;
  const used = (sheet.placements || []).reduce((a, p) => a + p.l * p.w, 0);
  const diced = dice.reduce((a, d) => a + d.w * d.h, 0);
  return { usedPct: used / A, dicedPct: diced / A, pieces: dice.length,
    salvaged: (sheet.placements || []).filter(p => p.salvage).length };
}
