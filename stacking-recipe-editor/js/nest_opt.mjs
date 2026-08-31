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

// <Operations> lives INSIDE <Shape>, after the ShapePoints — NOT beside it.
// The .moz keeps them apart (PartShapeXml and PartOpsXml are siblings under
// CabProdPart) and both of our writers used to carry that split across, which
// parses perfectly and is silently dropped: .NET's deserialiser is
// sequence-sensitive, so the patterns opened with no drilling on them and the
// KDT-612 produced no MPRs at all (Zac 2026-08-18: "the 'patterns' don't have
// any operations on them and generate gcode does not produce any mpr files for
// the 612"). Same lesson the product files taught once already — an op outside
// its container does not exist.
//
// EXPORTED because the job-zip CLI writes its own .opt and had the identical
// bug in its own copy. One rule, one implementation; a second copy is how this
// comes back.
//
// A part with no drilling still carries an empty <Operations> element — real
// posted files do (PBV2CRATED "BOT", TOPS "E1").
export function shapeWithOperations(shape, ops = [], partName = '?') {
  const NL2 = '\r\n';
  if (!/<\/Shape>\s*$/.test(String(shape || ''))) {
    // A self-closed or truncated shape would swallow the ops silently, which is
    // the exact failure this function exists to end.
    throw new Error(`part ${partName}: shape does not end in </Shape> — cannot nest its operations`);
  }
  const block = `${NL2}      <Operations Version="2">`
    + (ops.length ? `${NL2}        ` + ops.join(`${NL2}        `) : '')
    + `${NL2}      </Operations>${NL2}    `;
  return shape.replace(/<\/Shape>\s*$/, block + '</Shape>');
}

// An .opt is a FLATTENED snapshot: Mozaik evaluates every equation and writes
// the number with an empty *_Eq beside it. Across all 115 .opt files in the
// jobs tree, 2715 of 2715 holes carry Diameter_Eq="" X_Eq="" Y_Eq="" Depth_Eq=""
// Hide_Eq="" — not one non-empty equation anywhere, even when the layer product
// upstream is full of them (J004's own L1.moz has Diameter_Eq="MFD" x26). We
// were copying "MFA"/"MFP"/"PartTh" straight across; those are PRODUCT-scope
// parameters with no meaning in the optimizer. The numbers are already correct
// and are kept verbatim — only the strings go.
const EQ_ATTRS = ['Diameter_Eq', 'X_Eq', 'Y_Eq', 'Depth_Eq', 'Hide_Eq', 'HBoreAngle_Eq', 'HBoreDepth_Eq'];
export function stripEquations(op) {
  let out = op;
  for (const k of EQ_ATTRS) out = out.replace(new RegExp(`\\b${k}="[^"]*"`, 'g'), `${k}=""`);
  return out;
}

// Mozaik's EdgeBand column is a FLAG, not a list: "Custom*" when the part has
// any banded edge at all, "None" when it has none. Proven on the same-job pair —
// its Run #2 marks 61 of 66 parts Custom* and 5 None, and the room's own
// ShapePoint EBand attributes split 61/5 with the two bare codes (2A, 3C) being
// exactly the ones Mozaik calls None. We hardcoded "None" on every part, which
// is why the labels printed no banding notations even though the template was
// drawing the right thing (Zac 2026-08-20).
export function bandOf(shapeXml) {
  return /<ShapePoint\b[^>]*\bEBand="(?!0")[^"]*"/.test(String(shapeXml || '')) ? 'Custom*' : 'None';
}

// Every operation family the part carries, in file order. It was
// OperationHole ALONE, which is invisible on a bed (its parts are drilled) and
// fatal on a crate: a crate side is ten GROOVES and no holes, so the .opt part
// came out blank and the panel was cut as a plain rectangle. OperationGroove
// and OperationLineBore are the other two families our products use; anything
// else would be dropped just as silently, so an unknown family is REPORTED by
// the caller rather than skipped.
const OP_FAMILIES = ['OperationHole', 'OperationGroove', 'OperationLineBore'];
const OP_RE = new RegExp(
  OP_FAMILIES.map(k => `<${k}\\b[\\s\\S]*?<\\/${k}>|<${k}\\b[^>]*\\/>`).join('|'), 'g');
export function extractOps(block) {
  const ops = String(block || '').match(OP_RE) || [];
  return ops.map(stripEquations);
}
// Families present on the part that extractOps does NOT understand.
export function unknownOpFamilies(block) {
  const seen = new Set();
  for (const m of String(block || '').matchAll(/<Operation(\w+)\b/g)) {
    if (m[1] !== 's' && !OP_FAMILIES.includes('Operation' + m[1])) seen.add('Operation' + m[1]);
  }
  return [...seen];
}

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
  // Mozaik's cabinet registry. Every OptimizePart points at a cabinet through
  // AssyNo, and a real .opt declares those cabinets in a SECOND <RoomInfo> —
  // Number="1" with BaseCabString="R1C1,R1C2,..." and CabNames="1,{Job} L1|...".
  // Ours declared only the empty Number="0" Order Entry room, so every part
  // claimed cabinet "1" and nothing in the file said what cabinet 1 was. Keys
  // are BARE ordinals when only the design room holds cabinets, which is every
  // job we build (verified across J004, BOAZ, PBV2CRATED, LB Optimize).
  // The name MUST be the product's own ProdName, read out of the layer .moz —
  // never rebuilt from the job name. v3.62 reconstructed it as `${jobName} L${n}`
  // and buildOptFiles is called without a jobName, so a job exported as
  // "QBZ-V3-WHITE" registered cabinets called "Order L1..L8" while the room
  // held "QBZ-V3-WHITE L1..L8". Mozaik posted the router gcode (which needs
  // only sheet geometry) and produced ZERO 612 MPRs, because the drilling
  // comes from the ROOM PRODUCTS and nothing in the run resolved to one.
  const prodName = (lt, i) => lt.name
    || (lt.text.match(/<Product\b[^>]*\bProdName="([^"]*)"/) || [])[1]
    || `${jobName} L${lt.layer}`;
  const cabs = layerTexts.map((lt, i) => ({ key: String(i + 1), ref: `R1C${i + 1}`,
    layer: String(lt.layer), name: prodName(lt, i) }));
  const cabKeyOf = new Map(cabs.map(c => [c.layer, c.key]));

  const pool = [];
  for (const { layer, text, salvage: fromSalvageLayer } of layerTexts) {
    const blocks = text.match(/<CabProdPart\b[^>]*>[\s\S]*?<\/CabProdPart>/g) || [];
    for (const b of blocks) {
      const head = b.slice(0, b.indexOf('>'));
      const shape = (b.match(/<PartShapeXml\b[\s\S]*?<\/PartShapeXml>/) || [''])[0]
        .replace(/^<PartShapeXml/, '<Shape').replace(/<\/PartShapeXml>$/, '</Shape>');
      const ops = extractOps(b);
      pool.push({
        id: pool.length + 1, layer,
        name: attr(head, 'ReportName') || attr(head, 'Name') || ('P' + (pool.length + 1)),
        l: +attr(head, 'L', '0'), w: +attr(head, 'W', '0'),
        shape, ops, band: bandOf(shape),
        // a crate panel recovered from the offcut is not a layer of the bed,
        // so it carries no layer Comment — but it IS a real cabinet part, with
        // its grooves, which is the difference that gets it drilled
        ...(fromSalvageLayer ? { salvage: true } : {}),
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
  // How many of each key the pool can already answer. A salvaged crate panel
  // whose product IS in the job (the salvage layer) resolves to a REAL part
  // with its grooves; only the ones nothing in the job describes fall back to
  // the bare rectangle below.
  const supply = new Map();
  for (const p of pool) {
    const k = `${p.name}|${Math.round(p.l)}x${Math.round(p.w)}`;
    supply.set(k, (supply.get(k) || 0) + 1);
  }
  const salvage = [];
  const blind = [];
  for (const s of nest.sheets) for (const pl of (s.placements || [])) {
    if (!pl.salvage) continue;
    const k = `${pl.name}|${Math.round(pl.l)}x${Math.round(pl.w)}`;
    if ((supply.get(k) || 0) > 0) { supply.set(k, supply.get(k) - 1); continue; }
    blind.push(pl.name);
    const id = pool.length + salvage.length + 1;
    // A salvaged crate panel belongs to no cabinet. Mozaik has a key for
    // exactly that and it is not "0" (which no real file ever uses): BOAZ's
    // hand-added " T-BACK" carries AssyNo="N1", listed as "N1,T" in CabNames
    // and "R1N1" in BaseCabString.
    salvage.push({ id, layer: 0, cab: 'N1', name: pl.name, l: pl.l, w: pl.w, salvage: true,
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
  // PatternNumber is Mozaik's identity for a pattern — the router's own post
  // records index by it and name output ...-sheet01.NC upward. Every real file
  // numbers 1..N with no repeats (40 of 40 checked); we emitted "1" five times,
  // which is a duplicate key in the pattern list Zac was looking at.
  const sheetXml = nest.sheets.map((s, sheetIdx) => {
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
    // Planned remnants — the free fields the dice deliberately leaves whole,
    // computed by the nest page (scrap.mjs plannedRemnants) and carried on the
    // sheet. The .opt has a first-class record for these, and real files prove
    // the attribute frame: on a 2444.8x1225.6 sheet a specimen remnant reads
    // X="2105" Length="339.8" Width="1225.6" — so Length is the X-axis extent
    // and Width the Y-axis extent, sheet frame, NOT the part convention.
    // Without this a kept-whole field exists only as an absence of dice lines;
    // with it Mozaik shows the offcut and can offer it to a later run.
    const rems = (s.remnants || []).map((r, i) =>
      `    <OptimizeRemnantLocation X="${r.x}" Y="${r.y}" Width="${r.h}" Length="${r.w}" `
      + `Name="${esc(M.displayName)}" Comment="" Quan="1" LabelPrinted="False" RemnantNumber="${i + 1}" />`);
    return `  <OptimizeSheet Width="${M.width}" Length="${M.length}" Rotation="0" Quan="1" Flipped="False" `
      + `HasBeenCut="False" ExportedToCNCOperator="False" PatternNumber="${sheetIdx + 1}" PatternNumberSuffix="" `
      + `MachineName="${machine}">${NL}${[...locs, ...rems].join(NL)}${NL}  </OptimizeSheet>`;
  });

  const cabOf = (p) => p.cab || cabKeyOf.get(String(p.layer)) || String(p.layer);
  const shapeWithOps = (p) => shapeWithOperations(p.shape, p.ops, p.name);

  // PartNumbers IS the part's number, and it is what the drill program is NAMED
  // after: J004's part 9 posts as "1A-J004-09-19.MPR". Emit it empty and Mozaik
  // has nothing to name an MPR with, so it writes none at all — router gcode and
  // labels still appear, which is exactly the shape of Zac's report.
  // v3.65 set this to "" to match a specimen. That specimen was a Mozaik
  // RE-SAVE, which guts the file (documented in quarry/CLAUDE.md), and every
  // intact Mozaik .opt on the machine carries the real number. Matching a
  // degraded file is the trap this repo already had written down; I walked into
  // it anyway, so it is now written HERE, where the line is.
  const partXml = pool.map(p =>
    `  <OptimizePart PartID="${p.id}" PartNumbers="${p.id}" Quan="1" Name="${esc(p.name)}" `
    + `Width="${p.w}" Length="${p.l}" EdgeBand="${p.band || 'None'}" Color="" AssyNo="${cabOf(p)}" Comment="${p.salvage ? '' : 'L' + p.layer}" `
    + `UserAdded="False" RemakeJobName="" AllowRotation="1" LabelPrinted="False" `
    + `TextureName="${esc(M.textureName || '')}" TextureAbbr="${esc(M.textureAbbr || '')}" `
    + `TextureID="${esc(M.textureId)}">${NL}    ${shapeWithOps(p)}${NL}`
    + `    <BandMatTmpSel RootTemplateId="249" MissingTemplateName="Veneer" />${NL}`
    + `  </OptimizePart>`);

  // Element ORDER matches a real file: BatchRevisionNumber, parts, sheets,
  // RoomInfo, ToolsetByMachine, KerfByMachine. .NET XML deserialisation is
  // sequence-sensitive, so this is not cosmetic.
  // Both rooms, in order: the empty Order Entry block real files always carry,
  // then the design room that actually holds the cabinets.
  // The N1 pseudo-cabinet exists only for salvage nothing in the job
  // describes. Linked crate panels live in the salvage LAYER and are declared
  // like any other cabinet, which is what lets Mozaik resolve their drilling.
  const hasSalvage = pool.some(p => p.cab === 'N1');
  const baseCabString = cabs.map(c => c.ref).concat(hasSalvage ? ['R1N1'] : []).join(',');
  const cabNames = cabs.map(c => `${c.key},${c.name}`).concat(hasSalvage ? ['N1,Scrap salvage'] : []).join('|');
  const tailXml = `  <RoomInfo Number="0" Name="Order Entry" WallCabString="" BaseCabString="" CabNames="">${NL}`
    + `    <RoomNotes />${NL}  </RoomInfo>${NL}`
    + `  <RoomInfo Number="1" Name="Room 1" WallCabString="" BaseCabString="${esc(baseCabString)}" `
    + `CabNames="${esc(cabNames)}">${NL}    <RoomNotes />${NL}  </RoomInfo>${NL}`
    + `  <ToolsetByMachine Machine="NewCNC-VCNC" Toolset="KDT-612" />${NL}`
    + `  <KerfByMachine Machine="${machine}" Kerf="14.2875" />`;
  const optXml = `8${NL}<?xml version="1.0" encoding="utf-8" standalone="yes"?>${NL}`
    + `<OptimizeMaterial RunId="1" DisplayName="${M.displayName}" Abbr="${M.abbr}" MaterialId="${M.materialId}" `
    + `TextureId="${M.textureId}" Thickness="${M.thickness}" Width="${M.width}" Length="${M.length}" `
    // The MATERIAL's trims, which is what Mozaik writes — we were emitting the
    // nest's edge margin instead, so a run said 8 where the library says 6.
    // HasGrain was hardcoded False, so a grained board told Mozaik it could
    // turn parts freely on re-optimise. It rides from the material now.
    + `HasGrain="${M.hasGrain ? 'True' : 'False'}" WidthTrim="${M.widthTrim ?? 3}" LengthTrim="${M.lengthTrim ?? 3}" `
    + `FeedRate="100" Comment="" `
    + `CustomerName="" Timestamp="${(now() / 1000).toFixed(5)}" OptParamSpeed="2" `
    // SeqByCabN orders the run by cabinet number. 111 of 111 real files say
    // False; we were the only True in the tree. OptParamMachineName="" is NOT a
    // divergence — 73 of 114 real files carry it empty too.
    + `OptParamMachineName="" OptParamSeqByCabN="False" `
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
    + pool.map(p => `    <Item Quan="1" W="${p.w}" L="${p.l}" PartName="${esc(p.name)}" CabNos="${cabOf(p)}" `
        + `MaterialId="${M.materialId}" TextureId="${M.textureId}" Texture2Id="-1" `
        + `CutlistItemKey="PART:0#-1#Manual#${p.id}#False#False|1#1#${p.w}#${p.l}#1#39794075" />`).join(NL)
    + NL + `    <OptFilename Filename="${esc(jobsRoot)}\\${esc(jobName)}\\${esc(optFile)}" />${NL}`
    + `  </OptimizeRun>${NL}</OptimizeRuns>`;      // no trailing newline — real files have none

  return { optName: optFile, optXml, runsXml, blindSalvage: blind,
    poolCount: pool.length, placedCount: nest.sheets.reduce((a, s) => a + (s.placements || []).length, 0),
    unmatched };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
