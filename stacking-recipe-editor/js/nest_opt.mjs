// nest_opt.mjs — turn a nest into Mozaik optimizer state (.opt + OptimizeRuns).
//
// The job zip already carries the cabinet layers; this adds the NEST so the
// optimizer opens the job with the sheets already laid out instead of asking
// the operator to re-optimize (Zac 2026-08-18).
//
// Two files matter:
//   {DisplayName}_Run1.opt  OptimizeMaterial > OptimizePart pool (each part's
//                           real shape + drilling, lifted from the layer
//                           products so the post has true geometry) followed
//                           by one OptimizeSheet per sheet with an
//                           OptimizePartLocation per placement.
//   OptimizeRuns.xml        the run registration — a run absent from here does
//                           not appear in the optimizer at all (Zac).
//
// Pure strings in, pure strings out: no JSZip, no DOM, so it is testable
// outside a browser.

const NL = '\r\n';
const attr = (s, k, d = '') => { const m = s.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1] : d; };

export const DEFAULT_MATERIAL = {
  displayName: '19_Melamine_White', abbr: '19', materialId: '334', textureId: '13327',
  thickness: 19.05, length: 2770, width: 1550, lengthTrim: 3, widthTrim: 3,
};

// layerTexts: [{ layer, text }] — the generated layer .moz XML
// nest: { sheets:[{ placements:[{name,layer,l,w,x,y,rotation}] }], edge }
export function buildOptFiles({ nest, layerTexts, material = {}, machine = 'NewCNC-MD' }) {
  // an empty string from a UI field must not beat the default, and trims of 0
  // are legitimate, so merge field-by-field rather than spreading blindly
  const M = { ...DEFAULT_MATERIAL };
  for (const [k, v] of Object.entries(material || {})) {
    if (v === '' || v === null || v === undefined) continue;
    M[k] = v;
  }
  // A DIFFERENT material with no TextureId must not inherit white's id — that
  // would bind a black/monaco nest to the wrong board in Mozaik and look
  // perfectly fine on screen. -1 is Mozaik's own "unset" (it uses it for
  // Texture2Id), so the operator gets asked instead of getting white.
  if (material && material.displayName && material.displayName !== DEFAULT_MATERIAL.displayName
      && !String(material.textureId || '').trim()) {
    M.textureId = '-1';
  }
  if (!nest || !Array.isArray(nest.sheets) || !nest.sheets.length) return null;

  // --- part pool, straight from the layer products -------------------------
  const pool = [];
  for (const { layer, text } of layerTexts) {
    const blocks = text.match(/<CabProdPart\b[^>]*>[\s\S]*?<\/CabProdPart>/g) || [];
    for (const b of blocks) {
      const head = b.slice(0, b.indexOf('>'));
      const shape = (b.match(/<PartShapeXml\b[\s\S]*?<\/PartShapeXml>/) || [''])[0]
        .replace(/^<PartShapeXml/, '<Shape').replace(/<\/PartShapeXml>$/, '</Shape>');
      const ops = (b.match(/<OperationHole\b[\s\S]*?<\/OperationHole>|<OperationHole\b[^>]*\/>/g) || []);
      pool.push({
        id: pool.length + 1, layer,
        name: attr(head, 'ReportName') || attr(head, 'Name') || ('P' + (pool.length + 1)),
        l: +attr(head, 'L', '0'), w: +attr(head, 'W', '0'),
        shape, ops,
      });
    }
  }
  if (!pool.length) return null;

  // --- match placements to pool parts (name + dims, each consumed once) ----
  const byKey = new Map();
  for (const p of pool) {
    const k = `${p.name}|${Math.round(p.l)}x${Math.round(p.w)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const loose = [...pool];
  const unmatched = [];
  const sheetXml = nest.sheets.map((s) => {
    const locs = (s.placements || []).map((pl) => {
      const k = `${pl.name}|${Math.round(pl.l)}x${Math.round(pl.w)}`;
      let hit = (byKey.get(k) || []).shift();
      if (!hit) {                              // fall back to dims alone, then give up
        const i = loose.findIndex(q => Math.round(q.l) === Math.round(pl.l) && Math.round(q.w) === Math.round(pl.w));
        hit = i >= 0 ? loose[i] : null;
        if (hit) loose.splice(i, 1);
      } else { const i = loose.indexOf(hit); if (i >= 0) loose.splice(i, 1); }
      if (!hit) { unmatched.push(pl.name); return null; }
      return `    <OptimizePartLocation PartID="${hit.id}" PartNumber="${hit.id}" X="${pl.x}" Y="${pl.y}" `
        + `Rotation="${pl.rotation || 0}" Flipped="False" SentToRemakeBin="False" FromGroup="" `
        + `ExplodedFromGroup="" ExplodedFromGroupSuffix="" TakenFromRemakeBin="False" `
        + `ForceOnionSkin="False" LabelPrinted="False" />`;
    }).filter(Boolean);
    return `  <OptimizeSheet Width="${M.width}" Length="${M.length}" Rotation="0" Quan="1" Flipped="False" `
      + `HasBeenCut="False" ExportedToCNCOperator="False" PatternNumber="1" PatternNumberSuffix="" `
      + `MachineName="${machine}">${NL}${locs.join(NL)}${NL}  </OptimizeSheet>`;
  });

  const partXml = pool.map(p =>
    `  <OptimizePart PartID="${p.id}" PartNumbers="${p.id}" Quan="1" Name="${esc(p.name)}" `
    + `Width="${p.w}" Length="${p.l}" EdgeBand="None" Color="" AssyNo="${p.layer}" Comment="L${p.layer}" `
    + `UserAdded="False" RemakeJobName="">${NL}    ${p.shape}${NL}`
    + `    <Operations Version="2">${NL}      ${p.ops.join(NL + '      ')}${NL}    </Operations>${NL}`
    + `  </OptimizePart>`);

  const optXml = `8${NL}<?xml version="1.0" encoding="utf-8" standalone="yes"?>${NL}`
    + `<OptimizeMaterial RunId="1" DisplayName="${M.displayName}" Abbr="${M.abbr}" MaterialId="${M.materialId}" `
    + `TextureId="${M.textureId}" Thickness="${M.thickness}" Width="${M.width}" Length="${M.length}" `
    + `HasGrain="False" WidthTrim="${M.widthTrim ?? nest.edge ?? 3}" LengthTrim="${M.lengthTrim ?? nest.edge ?? 3}" `
    + `FeedRate="100" Comment="" `
    + `CustomerName="" OptParamSpeed="2" OptParamMachineName="" OptParamSeqByCabN="True" `
    + `OptParamSeqFlipsideFirst="False" OptParamRemnantUsagePolicy="0" IsLegacy="False">${NL}`
    + partXml.join(NL) + NL + sheetXml.join(NL) + NL + `</OptimizeMaterial>${NL}`;

  const runsXml = `1${NL}<?xml version="1.0" encoding="utf-8" standalone="yes"?>${NL}`
    + `<OptimizeRuns DefaultRunMachineTemplateId="-1">${NL}`
    + `  <OptimizeRun Id="1" Name="RUN1" MachineTemplateId="7" UserId="2" CabFilter="All" RoomString="R0-1">${NL}`
    + `    <RoomUniqueId Id="6" />${NL}`
    + pool.map(p => `    <Item Quan="1" W="${p.w}" L="${p.l}" PartName="${esc(p.name)}" CabNos="${p.layer}" `
        + `MaterialId="${M.materialId}" TextureId="${M.textureId}" Texture2Id="-1" `
        + `CutlistItemKey="PART:0#-1#Manual#${p.id}#False#False|1#1#${p.w}#${p.l}#1#39794075" />`).join(NL)
    + NL + `  </OptimizeRun>${NL}</OptimizeRuns>${NL}`;

  return { optName: `${M.displayName}_Run1.opt`, optXml, runsXml,
    poolCount: pool.length, placedCount: nest.sheets.reduce((a, s) => a + (s.placements || []).length, 0),
    unmatched };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
