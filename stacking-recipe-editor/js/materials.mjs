// materials.mjs — the sheet stock the nester packs onto, and the identity the
// .opt must carry so Mozaik recognises it.
//
// Zac 2026-08-18: "we need to have saved materials (which need to match mozaik
// in the end). right now in mozaik i have just 19_Melamine and it has a few
// textures but in reality the white is 1550x2770mm while the black and monaco
// we have are 5x8".
//
// So sheet size is a property of the TEXTURE, not the material — one material
// ("19_Melamine") with several textures on different board sizes. Each entry
// here is one buyable sheet: material identity + texture + that texture's
// actual dimensions and trims.
//
// The identity fields (name/abbr/materialId/textureId) are what Mozaik matches
// on. The white entry's values are lifted from a real posted job (J004), so it
// is known-good; anything you add needs its ids checked against Mozaik's
// material library or the optimizer will not bind it to the right stock.

const KEY = 'mbd_materials_v1';
export const MM_PER_IN = 25.4;
export const toMM = (v, unit) => unit === 'in' ? +(v * MM_PER_IN).toFixed(2) : +v;
export const fromMM = (v, unit) => unit === 'in' ? +(v / MM_PER_IN).toFixed(3) : +v;

// Known-good, straight out of a posted job.
const WHITE = {
  id: 'mel19-white',
  label: '19mm Melamine — White',
  displayName: '19_Melamine_White',   // Mozaik OptimizeMaterial DisplayName
  abbr: '19',
  materialId: '334',
  textureId: '13327',
  thickness: 19.05,
  length: 2770, width: 1550,
  lengthTrim: 3, widthTrim: 3,
  verified: true,                      // ids seen in a real posted .opt
};
// Zac has these on 5x8 stock. 5ft x 8ft = 1524 x 2438.4mm nominal; the exact
// board and the Mozaik texture ids still need confirming, so they are seeded
// UNVERIFIED rather than guessed silently into a posted job.
const FIVE_BY_EIGHT = { length: 2438.4, width: 1524, thickness: 19.05, lengthTrim: 3, widthTrim: 3 };
const BLACK = { id: 'mel19-black', label: '19mm Melamine — Black (5x8)',
  displayName: '19_Melamine_Black', abbr: '19', materialId: '334', textureId: '',
  ...FIVE_BY_EIGHT, verified: false };
const MONACO = { id: 'mel19-monaco', label: '19mm Melamine — Monaco (5x8)',
  displayName: '19_Melamine_Monaco', abbr: '19', materialId: '334', textureId: '',
  ...FIVE_BY_EIGHT, verified: false };

export const DEFAULT_MATERIALS = [WHITE, BLACK, MONACO];

export function loadMaterials() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(raw) && raw.length) return raw.map(normalize);
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_MATERIALS.map(normalize);
}
export function saveMaterials(list) {
  const clean = (list || []).filter(m => m && m.label).map(normalize);
  localStorage.setItem(KEY, JSON.stringify(clean));
  return clean;
}
export function normalize(m) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    id: m.id || ('mat-' + Math.random().toString(36).slice(2, 8)),
    label: String(m.label || m.displayName || 'Material'),
    displayName: String(m.displayName || 'Material'),
    abbr: String(m.abbr ?? ''),
    materialId: String(m.materialId ?? ''),
    textureId: String(m.textureId ?? ''),
    thickness: n(m.thickness, 19.05),
    length: n(m.length, 2770),
    width: n(m.width, 1550),
    // trims may legitimately be 0, so they are not run through the >0 guard
    lengthTrim: Number.isFinite(+m.lengthTrim) ? +m.lengthTrim : 3,
    widthTrim: Number.isFinite(+m.widthTrim) ? +m.widthTrim : 3,
    verified: !!m.verified,
  };
}
// What the nester needs: usable area after trims.
export function nestOptsFor(mat, gap = 16) {
  const m = normalize(mat);
  // A nest respects the SMALLER of the two trims as its edge margin when they
  // differ, so no part can ever land inside a trim on either axis.
  return { gap, edge: Math.min(m.lengthTrim, m.widthTrim), sheetL: m.length, sheetW: m.width,
    trimL: m.lengthTrim, trimW: m.widthTrim };
}
export function describe(m) {
  const n = normalize(m);
  return `${n.length} × ${n.width} × ${n.thickness}mm · trims ${n.lengthTrim}/${n.widthTrim}`;
}
