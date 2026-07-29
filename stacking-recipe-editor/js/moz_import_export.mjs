// moz_import_export.mjs — v1.0.0
//
// Glue between the SRE editor state and the moz_parse / moz_build
// modules. Everything the editor's Import/Export buttons touch lives
// here so the surrounding editor code stays as thin as possible.
//
// EXPORTS
//
//   importMozFiles(files)  →  Promise<{rows, importedParts, warnings, errors}>
//     Reads N `.moz` files, parses each via moz_parse.parseMoz, and
//     aggregates their parts into two parallel shapes:
//       - `rows`: the flat manifest shape the SRE's loadManifest(rows)
//         expects — {partNum, name, section, secIdx, Lmm, Wmm, Lin,
//         Win, qty, thickness}. One row per (partNum + geometry)
//         identity, with qty summed.
//       - `importedParts`: the full parsed parts (name, report, type,
//         W, L, qty, layer, bands, ops, pos) that moz_build's
//         buildJobZip needs. Stored on the SRE snapshot as
//         `snapshot.importedParts` so the recipe round-trips through
//         save/load with drill+band info intact.
//
//   exportJobZip(snapshot, {jobName}) → Promise<Blob>
//     Uses moz_build.buildJobZip to produce a Mozaik job zip from
//     snapshot.layers + snapshot.importedParts. Layer index i in the
//     snapshot becomes CabNo (i+1) in the job.
//
//   exportPerLayerMoz(snapshot) → Promise<Array<{name, text}>>
//     One .moz per layer (no zip wrapper) — same layer-.moz content
//     the full job zip contains, split out for individual download.
//
// SNAPSHOT SHAPE (Phase 1 additions):
//   snapshot.importedParts: [{
//     partNum, name, L, W, thickness, qty,   // identity + geometry
//     report, type, bands, ops, pos           // preserved from .moz
//   }]

import { parseMoz } from './moz_parse.mjs';
import { buildJobZip, APP_VERSION as MOZ_BUILD_VERSION } from './moz_build.mjs';

export const IMPORT_EXPORT_VERSION = '1.0.0';

// Product dimensions default — mirrors the moz-layer-editor's original
// prW/prH/prD DOM defaults for Boaz. Users don't need to touch these
// unless they're building a non-Boaz job whose layer-product envelope
// is a different size.
const DEFAULT_DIMS = { W: 425, H: 2046, D: 704.7 };

/**
 * Parse N .moz files (from a <input type="file"> or drag-drop
 * FileList) and return SRE-consumable rows + full imported parts.
 */
export async function importMozFiles(files) {
  const rows = [];
  const importedParts = [];
  const warnings = [];
  const errors = [];
  // Aggregate identical parts across files so the manifest has one row
  // per unique (partNum + geometry) with qty summed. Same shape the
  // paste-in-text importer produces.
  const bucket = new Map();

  const arr = Array.from(files || []);
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i];
    const text = await f.text();
    const parsed = parseMoz(text, f.name);
    for (const w of parsed.warnings) warnings.push(w);
    for (const e of parsed.errors) errors.push(e);
    if (!parsed.ok) continue;

    // Convention: use the .moz filename stem as the section label
    // (e.g. "Boaz L1 QBZ v0-16.moz" → "Boaz L1 QBZ v0-16"). This
    // scopes secIdx below by file, matching how paste-text order
    // scopes by cabinet section in the SRE.
    const section = f.name.replace(/\.moz$/i, '');
    const secIdx = i + 1;

    for (const p of parsed.parts) {
      // partNum synthesis: prefer the .moz's ReportName (short code like
      // "3A", "7F"), fall back to name-thickness-dim tuple. This becomes
      // the manifest key.
      const partNum = String(p.report || '').trim() ||
        `${p.name}|${Math.round(p.L)}x${Math.round(p.W)}`;

      // Thickness isn't a direct field on CabProdPart in v11 dialect —
      // Mozaik carries it via SUB_MATERIAL / job parms. For Phase 1
      // default to 19mm (standard 3/4" melamine); the SRE user can
      // adjust per-row if a nonstandard thickness gets imported.
      const thickness = 19;

      const identityKey = `${partNum}|${p.name}|${p.L}x${p.W}x${thickness}`;

      if (bucket.has(identityKey)) {
        bucket.get(identityKey).qty += p.qty;
      } else {
        const row = {
          partNum,
          name: p.name,
          section,
          secIdx,
          Lmm: p.L,
          Wmm: p.W,
          Lin: +(p.L / 25.4).toFixed(4),
          Win: +(p.W / 25.4).toFixed(4),
          qty: p.qty,
          thickness,
        };
        bucket.set(identityKey, row);
        rows.push(row);
      }

      // importedParts stores the full parsed shape for export
      // round-trip. Keeps per-part ops/bands/pos alive across the
      // save/load boundary.
      importedParts.push({
        partNum,
        name: p.name,
        L: p.L,
        W: p.W,
        thickness,
        qty: 1,                    // one entry per physical CabProdPart occurrence
        layer: p.layer,            // original .moz layer name (usually "L1", "L2")
        report: p.report,
        type: p.type,
        bands: p.bands,
        ops: p.ops,
        pos: p.pos,
        _sourceFile: f.name,
      });
    }
  }

  return { rows, importedParts, warnings, errors };
}

/**
 * Rebuild the layers{} dict that buildJobZip expects, from the SRE
 * snapshot. Layer index i in snapshot.layers → CabNo i+1.
 */
function _snapshotToLayers(snapshot) {
  const imported = Array.isArray(snapshot.importedParts) ? snapshot.importedParts : [];
  if (!imported.length) {
    throw new Error(
      'moz_import_export: snapshot has no importedParts — this recipe was ' +
      'saved before .moz import was wired, or was authored from a text-only ' +
      'source. Re-import the source .moz files first.'
    );
  }

  // Index imported parts by identity so we can look up each placed
  // part's full record (with ops/bands) from just its key fields.
  const byIdentity = new Map();
  for (const p of imported) {
    const k = `${p.partNum}|${p.name}|${p.L}x${p.W}x${p.thickness}`;
    if (!byIdentity.has(k)) byIdentity.set(k, []);
    byIdentity.get(k).push(p);
  }

  // Walk placed parts per layer and pull the matching original part.
  // If a placement doesn't match any imported part (shouldn't happen
  // unless user hand-edits), we skip with a warning.
  const layers = {};
  const missing = [];
  (snapshot.layers || []).forEach((placedParts, layerIdx) => {
    const layerName = `L${layerIdx + 1}`;
    for (const placed of (placedParts || [])) {
      const k = `${placed.partNum}|${placed.name}|${placed.L}x${placed.W}x${placed.thickness}`;
      const src = byIdentity.get(k);
      if (!src || !src.length) {
        missing.push(k);
        continue;
      }
      // Pull the first available occurrence of this identity out of the
      // bucket (each imported part slot represents one physical
      // CabProdPart, so each placement consumes one).
      const p = src.shift();
      // Override the layer on the copy so buildLayerMoz buckets it
      // under the SRE layer index.
      const copy = { ...p, layer: layerName };
      (layers[layerName] = layers[layerName] || []).push(copy);
    }
  });

  if (missing.length) {
    throw new Error(
      `moz_import_export: ${missing.length} placed parts have no matching imported source; ` +
      `first missing: ${missing[0]}. Re-import source .moz files or unplace the orphans.`
    );
  }

  return layers;
}

/**
 * Build a Mozaik job zip from the snapshot. Returns a Blob for direct
 * download via <a href={URL.createObjectURL(blob)}>.
 */
export async function exportJobZip(snapshot, { jobName } = {}) {
  const layers = _snapshotToLayers(snapshot);
  return buildJobZip({
    layers,
    jobName: jobName || snapshot.sku || 'Order',
    dims: DEFAULT_DIMS,
    prodPat: `${snapshot.sku || 'Layer'} {layer}`,
  });
}

/**
 * Emit per-layer .moz XML texts (no zip wrapper). Convenience for
 * users who want the layer masters individually.
 */
export async function exportPerLayerMoz(snapshot) {
  // Rely on buildJobZip's internals: we build the full zip then read
  // just the .moz entries out. This keeps a single source of truth for
  // the layer XML generation (moz_build).
  const blob = await exportJobZip(snapshot);
  if (typeof JSZip === 'undefined') {
    throw new Error('moz_import_export: JSZip is not loaded');
  }
  const zip = await JSZip.loadAsync(blob);
  const out = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    if (!/\.moz$/i.test(name)) continue;
    // Names inside the zip look like "<jobName>/<layerProductName>.moz";
    // strip the folder prefix for the download filename.
    const bare = name.split('/').pop();
    const text = await entry.async('string');
    out.push({ name: bare, text });
  }
  return out;
}
