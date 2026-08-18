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
  textureAbbr: '01',
  textureName: 'C:\\Users\\offic\\OneDrive\\Mozaik MBD\\Textures\\Wood\\Melamine\\White.jpg',
};

// layerTexts: [{ layer, text }] — the generated layer .moz XML
// nest: { sheets:[{ placements:[{name,layer,l,w,x,y,rotation}] }], edge }
export function buildOptFiles({ nest, layerTexts, material = {}, machine = 'NewCNC-MD',
  jobName = 'Order',
  // Mozaik stores an ABSOLUTE path to the .opt in OptimizeRuns.xml. It is the
  // operator's own path; this default matches the real jobs on Zac's machine.
  jobsRoot = 'C:\\Users\\offic\\OneDrive\\Mozaik MBD\\Jobs',
  now = Date.now } = {}) {
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
  function poolIndexSource() { return pool; }
  const byKey = new Map();
  for (const p of poolIndexSource()) {
    const k = `${p.name}|${Math.round(p.l)}x${Math.round(p.w)}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  // Salvage parts (crate panels recovered from the offcut) are not in any
  // layer product, so the pool gets a plain-rectangle entry for each — no
  // drilling, because there is none. Without this they render in the editor
  // and never get cut.
  const salvage = [];
  for (const s of nest.sheets) for (const pl of (s.placements || [])) {
    if (!pl.salvage) continue;
    const id = pool.length + salvage.length + 1;
    salvage.push({ id, layer: 0, name: pl.name, l: pl.l, w: pl.w, salvage: true,
      shape: `<Shape Version="2" Name="" Type="1" RadiusX="0" RadiusY="0" Source="1" Data1="0" Data2="0" `
        + `RotAng="0" DoNotTranslateTo00="False">`
        + [[0,0,1],[pl.l,0,2],[pl.l,pl.w,3],[0,pl.w,4]].map(([x,y,et],i)=>
            `<ShapePoint ID="${i}" X="${x}" Y="${y}" PtType="0" Data="0" EdgeType="${et}" Anchor="" `
            + `EBand="0" X_Eq="" Y_Eq="" Data_Eq="" LAdj="0" RAdj="0" TAdj="0" BAdj="0" Scribe="0" `
            + `Source="0" BoreHoles="0" EBandLock="False" SideName="" />`).join('')
        + `</Shape>`,
      ops: [], key: `${pl.name}|${Math.round(pl.l)}x${Math.round(pl.w)}` });
  }
  pool.push(...salvage);
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
    + `UserAdded="False" RemakeJobName="" AllowRotation="1" LabelPrinted="False" `
    + `TextureName="${esc(M.textureName || '')}" TextureAbbr="${esc(M.textureAbbr || '')}" `
    + `TextureID="${esc(M.textureId)}">${NL}    ${p.shape}${NL}`
    + `    <Operations Version="2">${NL}      ${p.ops.join(NL + '      ')}${NL}    </Operations>${NL}`
    + `    <BandMatTmpSel RootTemplateId="249" MissingTemplateName="Veneer" />${NL}`
    + `  </OptimizePart>`);

  // Element ORDER matches a real file: BatchRevisionNumber, parts, sheets,
  // RoomInfo, ToolsetByMachine, KerfByMachine. .NET XML deserialisation is
  // sequence-sensitive, so this is not cosmetic.
  const tailXml = `  <RoomInfo Number="0" Name="Order Entry" WallCabString="" BaseCabString="" CabNames="">${NL}`
    + `    <RoomNotes />${NL}  </RoomInfo>${NL}`
    + `  <ToolsetByMachine Machine="NewCNC-VCNC" Toolset="KDT-612" />${NL}`
    + `  <KerfByMachine Machine="${machine}" Kerf="14.2875" />`;
  const optXml = `8${NL}<?xml version="1.0" encoding="utf-8" standalone="yes"?>${NL}`
    + `<OptimizeMaterial RunId="1" DisplayName="${M.displayName}" Abbr="${M.abbr}" MaterialId="${M.materialId}" `
    + `TextureId="${M.textureId}" Thickness="${M.thickness}" Width="${M.width}" Length="${M.length}" `
    + `HasGrain="False" WidthTrim="${M.widthTrim ?? nest.edge ?? 3}" LengthTrim="${M.lengthTrim ?? nest.edge ?? 3}" `
    + `FeedRate="100" Comment="" `
    + `CustomerName="" Timestamp="${(now() / 1000).toFixed(5)}" OptParamSpeed="2" `
    + `OptParamMachineName="" OptParamSeqByCabN="True" `
    + `OptParamSeqFlipsideFirst="False" OptParamRemnantUsagePolicy="0" IsLegacy="False">${NL}`
    + `  <BatchRevisionNumber MachineName="${machine}" Number="1" />${NL}`
    + partXml.join(NL) + NL + sheetXml.join(NL) + NL + tailXml + NL + `</OptimizeMaterial>`;

  // Structure copied attribute-for-attribute from a real job. Mozaik threw
  // "unexpected exception while reading OptimizeRuns.xml" on the first cut,
  // which was missing OptFilename (the run had no .opt to point at), the
  // Timestamp, the second RoomUniqueId, and it ended with a trailing newline
  // the real files do not have.
  const optFile = `${M.displayName}_Run1.opt`;
  const runsXml = `1${NL}<?xml version="1.0" encoding="utf-8" standalone="yes"?>${NL}`
    + `<OptimizeRuns DefaultRunMachineTemplateId="-1">${NL}`
    + `  <OptimizeRun Id="1" Name="RUN1" Timestamp="${(now() / 1000).toFixed(3)}" MachineTemplateId="7" `
    + `UserId="2" CabFilter="All" RoomString="R0-1">${NL}`
    + `    <RoomUniqueId Id="5" />${NL}`
    + `    <RoomUniqueId Id="6" />${NL}`
    + pool.map(p => `    <Item Quan="1" W="${p.w}" L="${p.l}" PartName="${esc(p.name)}" CabNos="${p.layer}" `
        + `MaterialId="${M.materialId}" TextureId="${M.textureId}" Texture2Id="-1" `
        + `CutlistItemKey="PART:0#-1#Manual#${p.id}#False#False|1#1#${p.w}#${p.l}#1#39794075" />`).join(NL)
    + NL + `    <OptFilename Filename="${esc(jobsRoot)}\\${esc(jobName)}\\${esc(optFile)}" />${NL}`
    + `  </OptimizeRun>${NL}</OptimizeRuns>`;      // no trailing newline — real files have none

  return { optName: optFile, optXml, runsXml,
    poolCount: pool.length, placedCount: nest.sheets.reduce((a, s) => a + (s.placements || []).length, 0),
    unmatched };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
