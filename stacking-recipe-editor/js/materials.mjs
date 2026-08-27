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

import { MOZAIK_CATALOG } from './mozaik-catalog.mjs?v=3.96';

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
// v3.85 (Zac 2026-08-26) — the 5x8 board is REAL in Mozaik now, so two of the
// three overrides are gone. He split the one 19_Melamine material into 5x9
// (2770x1550, Id 334) and 5x8 (2460x1550, Id 340), both carrying all five
// finishes. Black and monaco were pinned here purely because Mozaik had no way
// to say those finishes live on a shorter board; it can say it now, natively,
// and the library and the nest agree on their own for the first time rather
// than by us patching around the disagreement.
//
// What survives is the one thing Mozaik still cannot know: the trims a run
// ACTUALLY used. The material declares 10/10; the posted white run that was
// cut used 3/3, and that is what its nests were built to.
const OVERRIDES = {
  '5x9White': { lengthTrim: 3, widthTrim: 3 },
};
const SLUG = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Saved nests are keyed sku::materialId, so the three materials that existed
// before the import KEEP their ids or every nest already saved orphans.
const LEGACY_IDS = {
  '19_Melamine_White': 'mel19-white',
  '19_Melamine_Black': 'mel19-black',
  '19_Melamine_Monaco': 'mel19-monaco',
  // v3.85 — Zac renamed the material in Mozaik (19_Melamine -> 5x9) and its
  // ReportName with it, so every displayName changed: 19_Melamine_White is now
  // 5x9White. The id is derived FROM displayName, so without these five lines
  // every nest ever saved on melamine would key to a new id and silently
  // orphan — the export would find nothing and quietly re-nest instead.
  // Chocolate and Gray are here too: they were never pinned before because
  // their slugs happened to be stable, which stopped being true the moment the
  // name changed.
  '5x9White': 'mel19-white',
  '5x9Black': 'mel19-black',
  '5x9Monaco': 'mel19-monaco',
  '5x9Chocolate': '19-melamine-chocolate',
  '5x9Gray': '19-melamine-gray',
};

// A picker's first entry is what gets used when nobody chooses, so it must not
// be an accident of sort order — Black led the list purely by alphabet. Mozaik
// names the default itself (19_Melamine's FaceTextureId is White), so that one
// leads, and materials keep library order behind it.
const CATALOG_ORDERED = [...MOZAIK_CATALOG].sort((a, b) =>
  (b.isDefaultTexture ? 1 : 0) - (a.isDefaultTexture ? 1 : 0));

export const DEFAULT_MATERIALS = CATALOG_ORDERED.map((c) => {
  const o = OVERRIDES[c.displayName] || {};
  return {
    id: LEGACY_IDS[c.displayName] || SLUG(c.displayName),
    label: c.label,
    displayName: c.displayName,
    abbr: c.abbr,
    materialId: c.materialId,
    textureId: c.textureId,
    // carried so reconcile() can re-find a row whose NAME changed in Mozaik
    // but whose finish did not — the last rung of the identity ladder
    textureName: c.textureName || '',
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
    if (Array.isArray(raw) && raw.length) {
      // migrate BEFORE reconcile: the retired board carries the old name too,
      // and moving it first means reconcile sees a row that already points at
      // the material it should have been on all along
      return raw.map(m => normalize(reconcile(migrateRetiredBoard(m))));
    }
  } catch (e) { /* fall through to defaults */ }
  return DEFAULT_MATERIALS.map(normalize);
}

// A material saved before the Mozaik import carries whatever was typed then —
// black and monaco had NO texture id at all, which the .opt writer turns into
// -1 and Mozaik declines to bind. Identity comes from the library; the shop's
// own numbers (label, board size, trims) are left exactly as edited.
// NAMES CHANGE IN MOZAIK; IDS DO NOT.
//
// This matched on displayName alone, which is Mozaik's ReportName — and Zac
// renamed it on 2026-08-26 (19_Melamine_Black -> 5x9Black). Every browser
// already holding the old name would have found no match and silently kept the
// stale record: old sheet size, blank texture id never filled, and — the part
// that actually breaks a cut — the DEAD NAME written into the .opt, where
// Mozaik looks for a material called 19_Melamine_Black and finds nothing.
//
// So the fallback walks down the identity ladder: exact name, then the
// (materialId, textureId) pair Mozaik itself binds on, then materialId plus the
// finish word the old name ends with (which is what rescues a record whose
// textureId was never filled in). On a hit by ANY route the row adopts the
// current displayName, or it would arrive here stale again on the next load.
// The board WE invented, now retired. Until 2026-08-26 black and monaco were
// pinned to 2438.4x1524 by an override here, because Mozaik could only hold one
// sheet per material and the shop's black is a shorter board. That number was
// our arithmetic on "5x8" (96in x 60in) and nobody ever measured it — Mozaik's
// own answer is 2460x1550.
//
// So any stored row still carrying it is carrying OUR guess, not the shop's
// measurement, and it is moved to the real material.
//
// SCOPED TO THE TWO IDS THE OVERRIDE ACTUALLY WROTE. Matching on the size alone
// was wrong and a probe caught it: a row somebody had typed 2438.4x1524 into by
// hand — 96in x 60in is a number a person really might enter — got silently
// moved onto Mozaik's 2460x1550. Only mel19-black and mel19-monaco could ever
// have inherited the guess, because those are the only two displayNames the
// override keyed on. Anything else at that size was measured by a human and is
// left alone (it will warn about the disagreement, which is correct).
const RETIRED_GUESS = { length: 2438.4, width: 1524 };
const RETIRED_IDS = new Set(['mel19-black', 'mel19-monaco']);
function migrateRetiredBoard(m) {
  if (!RETIRED_IDS.has(String(m.id || ''))) return m;
  const near = (a, b) => Math.abs(Number(a) - b) < 0.05;
  if (!near(m.length, RETIRED_GUESS.length) || !near(m.width, RETIRED_GUESS.width)) return m;
  const finish = String(m.textureName || '').trim()
    || (String(m.displayName || '').match(/(Black|Monaco|White|Gray|Chocolate)$/i) || [])[1] || '';
  if (!finish) return m;
  const real = DEFAULT_MATERIALS.find(d => /^5x8/.test(d.displayName)
    && String(d.textureName || '').toLowerCase() === finish.toLowerCase());
  if (!real) return m;                       // no real short board yet — leave it alone
  return { ...m,
    displayName: real.displayName, label: real.label,
    materialId: real.materialId, textureId: real.textureId, textureName: real.textureName,
    length: real.length, width: real.width,
    lengthTrim: real.lengthTrim, widthTrim: real.widthTrim,
    mozaikLength: real.mozaikLength, mozaikWidth: real.mozaikWidth,
    additionalSheetSizes: real.additionalSheetSizes };
}

function reconcile(m) {
  const blank = (v) => !String(v ?? '').trim() || String(v).trim() === '-1';
  const sameId = (a, b) => String(a ?? '') === String(b ?? '');
  const hit = DEFAULT_MATERIALS.find(d => d.displayName === m.displayName)
    || (!blank(m.textureId) && DEFAULT_MATERIALS.find(d =>
      sameId(d.materialId, m.materialId) && sameId(d.textureId, m.textureId)))
    || DEFAULT_MATERIALS.find(d => sameId(d.materialId, m.materialId)
      && d.textureName
      && String(m.displayName || '').toLowerCase().endsWith(String(d.textureName).toLowerCase()));
  if (!hit) return m;
  return { ...m,
    // the name Mozaik answers to TODAY — a stale one binds to nothing
    displayName: hit.displayName,
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
