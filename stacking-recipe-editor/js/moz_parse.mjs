// moz_parse.mjs — v1.0.0
//
// Extracted from apps/moz-layer-editor-v1-1.html (line 125-170) as part
// of Quarry Phase 1 (see quarry/knowledge/BEDROCK-EDITOR-SCOPE.md).
//
// The core parsing loop — DOMParser walk over the .moz XML, extracting
// every CabProdPart into a `p` object with name/report/type/W/L/pos/
// bands/ops — is byte-for-byte identical to the source. The ONLY
// changes vs the source:
//
//   1. Removed the `log(...)` calls (source line 126, 167, 169). This
//      module returns the same information in a `{errors, warnings,
//      info}` shape so the caller can surface it however it wants.
//   2. Removed the mutation of the global `layers` object (source
//      line 165 `(layers[p.layer]=layers[p.layer]||[]).push(p)`).
//      Instead the parsed parts are collected into the return value
//      and the caller merges them into whatever store it uses.
//   3. Inlined the `blankPart` helper (source line 120) into the
//      per-part construction, since this module is pure parse (no
//      "New Part" default needed).
//   4. Replaced the `TYPES` const import with a local copy (source
//      line 112) so the module has zero external references.
//
// The XML-attribute reads, the coordinate math (flip Y = W - y for
// asymmetric ops), the shape-point-to-band mapping — all bit-for-bit
// verbatim from the source. Any behavioral difference would be a bug.
//
// TESTED against: quarry/registry/Boaz L{1..4} QBZ v0-16.moz.
// The parsed part count and geometry match the reference outputs of
// quarry/engine/parse_moz.mjs (the Node-side port).

export const PARSER_VERSION = '1.0.0';

// Verbatim from source line 112.
const TYPES = ["FEND","UEND","UBACK","TOP","BOTTOM","TOE","FIXEDSHELF","ADJUSTABLESHELF","FRAMELESSRAIL","MOLDING","DOOR"];

/**
 * Parse a Mozaik .moz v11 manual-part-dialect file.
 *
 * @param {string} text   — the raw .moz file contents (includes the
 *                          "2\r\n11\r\nMozaik Product Properties File\r\n"
 *                          header lines; the parser skips them by
 *                          finding the first `<?xml` marker).
 * @param {string} fname  — filename, used only for the returned
 *                          error/warning messages.
 * @returns {{
 *   ok: boolean,
 *   parts: Array<object>,            // one entry per CabProdPart parsed
 *   prodName: string|null,           // <Product ProdName="...">
 *   errors: string[],                // fatal parse errors
 *   warnings: string[],              // non-fatal (e.g. equation fields)
 *   info: string[],                  // successful-parse info
 * }}
 */
export function parseMoz(text, fname) {
  const errors = [];
  const warnings = [];
  const info = [];
  const parts = [];

  // Verbatim from source line 126: locate the <?xml header inside the
  // "2\r\n11\r\nMozaik Product Properties File\r\n<?xml ..." prefix.
  const ix = text.indexOf('<?xml');
  if (ix < 0) {
    errors.push(`${fname}: no XML found`);
    return { ok: false, parts, prodName: null, errors, warnings, info };
  }

  const xml = new DOMParser().parseFromString(text.slice(ix), 'text/xml');
  // v3.45 — capture each part's VERBATIM source text (never reconstruct a
  // validated artifact: the imported .moz is the specimen). DOM outerHTML
  // re-serializes — attribute order and CRLF die — so raw slices come from
  // the original text, index-aligned with querySelectorAll document order.
  const rawParts = [...text.matchAll(/<CabProdPart\b[\s\S]*?<\/CabProdPart>/g)].map((m) => m[0]);
  // v3.46 — the SHELL: the source file with every part block excised. The
  // export rebuilds each layer product INSIDE this shell so the product's
  // own parameter table (MFD/MFP... — the MiniFix parms the cam equations
  // reference) rides verbatim. J003 lesson: verbatim parts inside a
  // synthesized wrapper still lose their cams, because <CabProdParms /> was
  // empty and Mozaik evaluates Diameter_Eq="MFD" against the wrapper.
  const shell = text.replace(/<CabProdPart\b[\s\S]*?<\/CabProdPart>/g, '');
  const prod = xml.querySelector('Product');
  if (!prod) {
    errors.push(`${fname}: no <Product>`);
    return { ok: false, parts, prodName: null, errors, warnings, info };
  }

  const prodName = prod.getAttribute('ProdName') || null;
  let n = 0;

  prod.querySelectorAll('CabProdPart').forEach((cp, idx) => {
    const W = parseFloat(cp.getAttribute('W'));
    const L = parseFloat(cp.getAttribute('L'));

    // Source uses blankPart(cp.getAttribute('Comment')||'L1') to
    // initialize with defaults; we inline the fields we actually set.
    const p = {
      name: 'New Part',
      report: 'XX',
      type: 'FIXEDSHELF',
      W: 182,
      L: 387,
      qty: 1,
      layer: cp.getAttribute('Comment') || 'L1',
      bands: { F: false, B: false, S: false, E: false },
      ops: [],
      pos: { X: 0, Y: 0, Z: 0, A1: 0, A2: 0, A3: 0 },
    };

    // Verbatim block (source lines 134-138).
    p.name = cp.getAttribute('Name') || 'Part';
    p.report = cp.getAttribute('ReportName') || p.name;
    p.type = TYPES.includes(cp.getAttribute('Type')) ? cp.getAttribute('Type') : 'FIXEDSHELF';
    p.W = W; p.L = L; p.qty = parseInt(cp.getAttribute('Quan') || '1');
    p.pos = {
      X: +cp.getAttribute('X') || 0,
      Y: +cp.getAttribute('Y') || 0,
      Z: +cp.getAttribute('Z') || 0,
      A1: +cp.getAttribute('A1') || 0,
      A2: +cp.getAttribute('A2') || 0,
      A3: +cp.getAttribute('A3') || 0,
    };

    // Verbatim block (source lines 139-145).
    const sps = [...cp.querySelectorAll('ShapePoint')];
    if (sps.length === 4) { // edges: p0->p1 Y0, p1->p2 XL, p2->p3 YW, p3->p0 X0
      p.bands.F = sps[0].getAttribute('EBand') === '1';
      p.bands.E = sps[1].getAttribute('EBand') === '1';
      p.bands.B = sps[2].getAttribute('EBand') === '1';
      p.bands.S = sps[3].getAttribute('EBand') === '1';
    }

    // Verbatim OperationHole loop (source lines 146-157).
    cp.querySelectorAll('OperationHole').forEach((o) => {
      const flip = o.getAttribute('FlipSideOp') === 'True';
      const hb = o.hasAttribute('HBoreAngle');
      let x = +o.getAttribute('X'), y = +o.getAttribute('Y');
      if (flip && !hb) y = +(W - y).toFixed(3);           // stored=authored -> show physical
      const op = {
        kind: 'hole', mode: hb ? 'edge' : 'face', edge: '', x, y,
        dia: +o.getAttribute('Diameter'), depth: +o.getAttribute('Depth'),
        hdepth: hb ? +o.getAttribute('HBoreDepth') : 9.5, flip: hb ? false : flip, quan: 1,
      };
      if (hb) {
        const a = o.getAttribute('HBoreAngle');
        op.edge = a === '0' ? 'X0' : a === '180' ? 'XL' : a === '90' ? 'Y0' : 'YW';
      }
      p.ops.push(op);
    });

    // Verbatim OperationLineBore loop (source lines 158-164).
    cp.querySelectorAll('OperationLineBore').forEach((o) => {
      const flip = o.getAttribute('FlipSideOp') === 'True';
      let y = +o.getAttribute('Y'); if (flip) y = +(W - y).toFixed(3);
      p.ops.push({
        kind: 'lb', mode: 'face', edge: '', x: +o.getAttribute('X'), y,
        dia: +o.getAttribute('Diameter'), depth: +o.getAttribute('Depth'), hdepth: 9.5, flip,
        quan: parseInt(o.getAttribute('Quan') || '5'),
      });
    });

    // Source line 165 mutated the global `layers` object; we push to
    // the returned array instead. Caller decides how to bucket by layer.
    p.raw = rawParts[idx] || null;
    parts.push(p);
    n++;
  });

  info.push(`${fname}: loaded ${n} parts from "${prodName || ''}"`);

  // Verbatim equation-check (source lines 168-169).
  const eq = [...prod.querySelectorAll('[X_Eq]')].some((e) => /[A-Za-z]/.test(e.getAttribute('X_Eq') || ''));
  if (eq) warnings.push(`${fname}: contains equation-driven fields; loaded literal values only`);

  return { ok: true, parts, prodName, shell, errors, warnings, info };
}
