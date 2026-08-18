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

import { MOZAIK_CATALOG } from './mozaik-catalog.mjs';

const KEY = 'mbd_materials_v1';
export const MM_PER_IN = 25.4;
export const toMM = (v, unit) => unit === 'in' ? +(v * MM_PER_IN).toFixed(2) : +v;
export const fromMM = (v, unit) => unit === 'in' ? +(v / MM_PER_IN).toFixed(3) : +v;

// The catalogue is IMPORTED from Mozaik's own library (Data/Materials.dat +
// Textures.dat) by quarry/scripts/import-mozaik-materials.mjs, so the ids the
// .opt carries are the ids Mozaik matches on rather than numbers somebody
// copied. Re-run the importer after adding a finish or a board size there.
//
// Two things the library CANNOT tell us, held as explicit overrides below:
//   * the trims a run actually used (the material declares 6/6; the posted
//     white run that was cut used 3/3, and that is what the nest was built to)
//   * the board a finish is really bought on (Mozaik has one 2770x1550 sheet
//     for 19_Melamine with additional sheet sizes OFF, but the black and
//     monaco in the rack are 5x8) — physical truth wins for the NEST, and the
//     disagreement is reported instead of being quietly resolved either way.
const FIVE_BY_EIGHT = { length: 2438.4, width: 1524 };
const OVERRIDES = {
  '19_Melamine_White': { lengthTrim: 3, widthTrim: 3 },
  '19_Melamine_Black': { ...FIVE_BY_EIGHT, lengthTrim: 3, widthTrim: 3 },
  '19_Melamine_Monaco': { ...FIVE_BY_EIGHT, lengthTrim: 3, widthTrim: 3 },
};
const SLUG = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Saved nests are keyed sku::materialId, so the three materials that existed
// before the import KEEP their ids or every nest already saved orphans.
const LEGACY_IDS = {
  '19_Melamine_White': 'mel19-white',
  '19_Melamine_Black': 'mel19-black',
  '19_Melamine_Monaco': 'mel19-monaco',
};

export const DEFAULT_MATERIALS = MOZAIK_CATALOG.map((c) => {
  const o = OVERRIDES[c.displayName] || {};
  return {
    id: LEGACY_IDS[c.displayName] || SLUG(c.displayName),
    label: c.label,
    displayName: c.displayName,
    abbr: c.abbr,
    materialId: c.materialId,
    textureId: c.textureId,
    thickness: c.thickness,
    length: o.length ?? c.length,
    width: o.width ?? c.width,
    lengthTrim: o.lengthTrim ?? c.lengthTrim,
    widthTrim: o.widthTrim ?? c.widthTrim,
    // what Mozaik itself believes, kept so a mismatch can be NAMED
    mozaikLength: c.length, mozaikWidth: c.width,
    additionalSheetSizes: c.additionalSheetSizes,
    verified: !!(c.materialId && c.textureId && String(c.textureId) !== '-1'),
  };
});

export function loadMaterials() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(raw) && raw.length) return raw.map(m => normalize(reconcile(m)));
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_MATERIALS.map(normalize);
}

// A material saved before the Mozaik import carries whatever was typed then —
// black and monaco had NO texture id at all, which the .opt writer turns into
// -1 and Mozaik declines to bind. Identity comes from the library; the shop's
// own numbers (label, board size, trims) are left exactly as edited.
function reconcile(m) {
  const hit = DEFAULT_MATERIALS.find(d => d.displayName === m.displayName);
  if (!hit) return m;
  const blank = (v) => !String(v ?? '').trim() || String(v).trim() === '-1';
  return { ...m,
    materialId: blank(m.materialId) ? hit.materialId : m.materialId,
    textureId: blank(m.textureId) ? hit.textureId : m.textureId,
    mozaikLength: hit.mozaikLength, mozaikWidth: hit.mozaikWidth,
    additionalSheetSizes: hit.additionalSheetSizes };
}

// Finishes Mozaik knows about that this browser has never seen — offered so a
// new finish added in Mozaik does not stay invisible here forever.
export function missingFromSaved(list) {
  const have = new Set((list || []).map(m => m.displayName));
  return DEFAULT_MATERIALS.filter(d => !have.has(d.displayName));
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
    mozaikLength: Number.isFinite(+m.mozaikLength) ? +m.mozaikLength : null,
    mozaikWidth: Number.isFinite(+m.mozaikWidth) ? +m.mozaikWidth : null,
    additionalSheetSizes: !!m.additionalSheetSizes,
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

// Every reason this material might not come out of Mozaik as the board you
// meant. Empty array = nothing known to be wrong. The job export shows these
// BEFORE the download rather than after the sheets are cut.
export function materialWarnings(mat) {
  const m = normalize(mat);
  const out = [];
  if (!String(m.materialId || '').trim()) out.push('no Material ID — Mozaik cannot match this material');
  const tex = String(m.textureId || '').trim();
  if (!tex || tex === '-1') out.push('no Texture ID — Mozaik will not bind this to the right finish');
  if (m.mozaikLength && m.mozaikWidth
      && (Math.abs(m.length - m.mozaikLength) > 0.5 || Math.abs(m.width - m.mozaikWidth) > 0.5)) {
    out.push(`sheet is ${m.length}×${m.width} here but ${m.mozaikLength}×${m.mozaikWidth} in Mozaik`
      + (m.additionalSheetSizes ? '' : ', and that material has additional sheet sizes turned OFF'));
  }
  return out;
}
