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

export const IN = 25.4;
export const DEFAULT_MAX_PIECE_IN = 11.9;

// Crate panels, from "v2 Crate 80x43xH". qty is per crate; leave a part out of
// the catalogue (or set qty 0) and it will not be salvaged.
export const DEFAULT_CATALOG = [
  { name: 'BOT', label: 'Crate bottom', l: 2032, w: 1092.2, qty: 1 },
  { name: 'TOP', label: 'Crate top', l: 2032, w: 1092.2, qty: 1 },
  { name: 'S1', label: 'Crate side', l: 2032, w: 495.3, qty: 2 },
  { name: 'E1', label: 'Crate end', l: 1066.8, w: 495.3, qty: 2 },
];

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
export function freeRects(sheet, { sheetL, sheetW, edge = 3, gap = 16 }) {
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
  return out.filter(r => r.w > 1 && r.h > 1).map(r => ({
    x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2),
  }));
}

function fitsClear(cand, placements, gap) {
  const A = [cand.x, cand.x + cand.w, cand.y, cand.y + cand.h];
  return !placements.some(p => {
    const B = box(p);
    const dx = Math.max(B[0] - A[1], A[0] - B[1]), dy = Math.max(B[2] - A[3], A[2] - B[3]);
    return Math.max(dx, dy) < gap - 0.01;
  });
}

// Greedy: biggest catalogue part that still fits, into the biggest free rect.
// Returns the salvaged placements (same shape as nest placements, flagged
// salvage:true so the editor and the .opt can treat them separately).
export function fitSalvage(sheet, opts, catalog = DEFAULT_CATALOG, budget = null) {
  const { gap = 16 } = opts;
  const placed = [...(sheet.placements || [])];
  const got = [];
  const left = catalog.map(c => ({ ...c, remaining: budget ? (budget[c.name] ?? c.qty) : c.qty }))
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
          if (w > fr.w + 0.01 || h > fr.h + 0.01) continue;
          const cand = { x: fr.x, y: fr.y, w, h };
          if (!fitsClear(cand, placed, gap)) continue;
          const pl = { name: c.name, label: c.label, layer: 0, salvage: true,
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

// Everything still empty, split so no piece exceeds maxPiece on either side.
export function dicePlan(sheet, opts, maxPieceIn = DEFAULT_MAX_PIECE_IN) {
  const MAX = maxPieceIn * IN;
  const out = [];
  for (const fr of freeRects(sheet, opts)) {
    const nx = Math.max(1, Math.ceil(fr.w / MAX)), ny = Math.max(1, Math.ceil(fr.h / MAX));
    const cw = fr.w / nx, ch = fr.h / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      out.push({ x: +(fr.x + i * cw).toFixed(2), y: +(fr.y + j * ch).toFixed(2),
        w: +cw.toFixed(2), h: +ch.toFixed(2) });
    }
  }
  return out;
}

export function scrapSummary(sheet, opts, dice) {
  const A = opts.sheetL * opts.sheetW;
  const used = (sheet.placements || []).reduce((a, p) => a + p.l * p.w, 0);
  const diced = dice.reduce((a, d) => a + d.w * d.h, 0);
  return { usedPct: used / A, dicedPct: diced / A, pieces: dice.length,
    salvaged: (sheet.placements || []).filter(p => p.salvage).length };
}
