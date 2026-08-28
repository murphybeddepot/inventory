// derive_nest.mjs — build one product's nest from ANOTHER product's proven nest.
//
// Zac 2026-08-28, needing a Boaz Double layout and not wanting to hand-nest a
// bed whose Queen layout is already proven on the floor:
//   "is there a way to pretty closely match the stacking recipe of the queen
//    (maybe center the smaller double parts on the queen part locations)?"
//
// That is exactly what this does, and centring is the RIGHT primitive rather
// than a convenient one: a Double part is never larger than its Queen
// counterpart (checked, below), so a part centred in its counterpart's slot is
// strictly INSIDE a rectangle that already did not overlap anything. The result
// therefore cannot collide, cannot leave the sheet the source fitted, and keeps
// every sheet, layer and position the operator already knows. The saved metric
// is not material — it is that the layout on the table does not change.
//
// WHAT IT REFUSES, because a nest that is quietly wrong gets cut:
//   * a target part LARGER than the source slot in either axis   (would collide)
//   * a target part with no counterpart placement                (would go missing)
//   * a source placement with no target part                     (phantom)
//   * anything landing outside the target sheet's usable area    (smaller board)
// Every refusal names the part. A derived nest is returned only when the whole
// set is accounted for; a partial layout that reads like a whole one is the
// failure this module exists to prevent.
//
// PAIRING is by code and then by SIZE RANK, never file order. A code with
// several defs (Boaz has 29 codes over 66 parts) must line its biggest source
// placement up with its biggest target part, or two same-code parts of
// different sizes swap slots and both centre wrong.

const TOL = 0.01;

// footprint on the sheet, honouring the placement's rotation
function foot(l, w, rotation) {
  return (+rotation === 90) ? { fw: +w, fh: +l } : { fw: +l, fh: +w };
}
const area = (o) => o.fw * o.fh;

/**
 * @param source  a saved nest: { sheets: [{ layers, placements: [...] }] }
 * @param targetParts  [{ name, l, w, layer }] — the product being derived
 * @param opts  { sheetL, sheetW, edge, gap, sku, material }
 * @returns { ok, nest, report }
 */
export function deriveNest(source, targetParts, opts = {}) {
  const sheetL = +opts.sheetL, sheetW = +opts.sheetW;
  const edge = Number.isFinite(+opts.edge) ? +opts.edge : 10;
  const errors = [], warnings = [];

  const srcSheets = (source && Array.isArray(source.sheets)) ? source.sheets : null;
  if (!srcSheets || !srcSheets.length) {
    return { ok: false, nest: null, report: { errors: ['the source nest has no sheets'], warnings: [], pairs: [] } };
  }

  // ---- collect source placements (salvage rides through untouched) --------
  const byName = new Map();
  let salvageCount = 0;
  srcSheets.forEach((sh, si) => (sh.placements || []).forEach((p, pi) => {
    if (p.salvage) { salvageCount++; return; }
    const k = String(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push({ p, si, pi, ...foot(p.l, p.w, p.rotation) });
  }));

  const tgtByName = new Map();
  for (const t of (targetParts || [])) {
    const k = String(t.name);
    if (!tgtByName.has(k)) tgtByName.set(k, []);
    tgtByName.get(k).push(t);
  }

  // ---- pair by code, then by size rank ------------------------------------
  const moves = new Map();          // "si:pi" -> { part, x, y, fw, fh }
  const pairs = [];
  for (const [code, srcs] of byName) {
    const tgts = (tgtByName.get(code) || []).slice();
    if (!tgts.length) { errors.push(`${code}: the source nest places ${srcs.length}, this product has none`); continue; }
    if (tgts.length !== srcs.length) {
      errors.push(`${code}: source places ${srcs.length}, this product has ${tgts.length} — counts must match`);
      continue;
    }
    const S = srcs.slice().sort((a, b) => area(b) - area(a));
    const T = tgts.slice().sort((a, b) => (b.l * b.w) - (a.l * a.w));
    for (let i = 0; i < S.length; i++) {
      const s = S[i], t = T[i];
      const { fw, fh } = foot(t.l, t.w, s.p.rotation);
      if (fw > s.fw + TOL || fh > s.fh + TOL) {
        errors.push(`${code}: ${t.l}x${t.w} does not fit the source slot ${s.p.l}x${s.p.w}`
          + ` — centring only works when the derived part is the smaller one`);
        continue;
      }
      const x = +(s.p.x + (s.fw - fw) / 2).toFixed(2);
      const y = +(s.p.y + (s.fh - fh) / 2).toFixed(2);
      moves.set(`${s.si}:${s.pi}`, { part: t, x, y, fw, fh, src: s.p });
      pairs.push({ code, from: `${s.p.l}x${s.p.w}`, to: `${t.l}x${t.w}`,
        inset: +(((s.fw - fw) / 2)).toFixed(1), sheet: s.si + 1,
        layer: +s.p.layer || 1, layerWas: +t.layer || null });
    }
  }
  for (const [code, tgts] of tgtByName) {
    if (!byName.has(code)) errors.push(`${code}: ${tgts.length} part(s) here, but the source nest never places it`);
  }

  // ---- rebuild the sheets -------------------------------------------------
  const sheets = srcSheets.map((sh, si) => {
    const placements = [];
    (sh.placements || []).forEach((p, pi) => {
      if (p.salvage) { placements.push({ ...p }); return; }
      const m = moves.get(`${si}:${pi}`);
      if (!m) return;                                  // already an error
      // THE LAYER COMES FROM THE SOURCE. Zac asked to match the Queen's
      // stacking recipe, and the stacking recipe IS the layer assignment — a
      // derived nest that kept the target's own layers would put the parts in
      // the Queen's places in the Double's stacking order, which is neither
      // product's layout. `layersFrom:'target'` opts out.
      const layer = (opts.layersFrom === 'target')
        ? (+m.part.layer || +p.layer || 1) : (+p.layer || +m.part.layer || 1);
      placements.push({ name: m.part.name, layer,
        key: m.part.key || p.key, l: +m.part.l, w: +m.part.w,
        x: m.x, y: m.y, rotation: +p.rotation || 0 });
    });
    return { layers: sh.layers, placements,
      utilization: +(placements.reduce((a, p) => {
        const f = foot(p.l, p.w, p.rotation); return a + f.fw * f.fh;
      }, 0) / (sheetL * sheetW)).toFixed(3) };
  });

  // ---- verify: on the sheet, and not on top of each other -----------------
  sheets.forEach((sh, si) => {
    const rects = sh.placements.map((p) => {
      const f = foot(p.l, p.w, p.rotation);
      return { n: p.name, x0: p.x, y0: p.y, x1: p.x + f.fw, y1: p.y + f.fh };
    });
    for (const r of rects) {
      if (r.x0 < edge - TOL || r.y0 < edge - TOL || r.x1 > sheetL - edge + TOL || r.y1 > sheetW - edge + TOL) {
        errors.push(`sheet ${si + 1}: ${r.n} lands outside the usable area`
          + ` (${r.x0.toFixed(0)},${r.y0.toFixed(0)})-(${r.x1.toFixed(0)},${r.y1.toFixed(0)})`
          + ` on ${sheetL}x${sheetW} with ${edge}mm trim`);
      }
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x0 < b.x1 - TOL && b.x0 < a.x1 - TOL && a.y0 < b.y1 - TOL && b.y0 < a.y1 - TOL) {
        errors.push(`sheet ${si + 1}: ${a.n} overlaps ${b.n}`);
      }
    }
  });

  if (salvageCount) warnings.push(`${salvageCount} salvage placement(s) carried across unchanged`);

  const ok = errors.length === 0;
  return {
    ok,
    nest: ok ? { sheets, sku: opts.sku, material: opts.material,
      derivedFrom: opts.sourceLabel || null } : null,
    report: { errors, warnings, pairs,
      sheetCount: sheets.length,
      placed: sheets.reduce((a, s) => a + s.placements.filter((p) => !p.salvage).length, 0) },
  };
}

// The recipe side is a pure code->layer copy: stacking order is about how the
// parts go on the pallet, and a Double stacks in the same order as a Queen.
// Returns the target parts wearing the source's layers, plus anything the
// source could not tell us about.
export function deriveLayers(sourceParts, targetParts) {
  const layerOf = new Map();
  for (const p of (sourceParts || [])) if (!layerOf.has(String(p.name))) layerOf.set(String(p.name), +p.layer || 1);
  const missing = [];
  const parts = (targetParts || []).map((t) => {
    const l = layerOf.get(String(t.name));
    if (l === undefined) { missing.push(t.name); return { ...t }; }
    return { ...t, layer: l };
  });
  return { parts, missing: [...new Set(missing)] };
}
