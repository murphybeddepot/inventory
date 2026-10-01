import { fitSalvage } from './scrap.mjs?v=4.49';
import { CRATE_BY_KEY } from './crate_parts.mjs?v=4.49';

// Add exactly the crate parts the operator requests. Catalogue standing quantities
// do not apply; the only limit is actual space on the chosen sheets.
export function addChosenCrates(nest, sheetIndex, requests, opts, scope = 'current') {
  if (!nest?.sheets?.length) throw new Error('No nest sheets are available.');
  if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || sheetIndex >= nest.sheets.length)
    throw new Error('Choose a sheet first.');
  if (!['current', 'existing', 'extend'].includes(scope)) throw new Error('Unknown sheet choice.');
  const seen = new Set();
  const rows = requests.map(row => {
    const qty = Number(row.qty);
    if (!Number.isSafeInteger(qty) || qty < 0) throw new Error(`Enter a whole-number quantity for ${row.label || row.name}.`);
    const part = CRATE_BY_KEY.get(row.src);
    if (!part) throw new Error(`Crate part ${row.label || row.name} is not linked to a valid product.`);
    if (seen.has(row.src)) throw new Error(`Crate part ${part.label} was selected twice.`);
    seen.add(row.src);
    return { key: part.key, src: part.key, name: part.code, label: part.label, l: part.L, w: part.W, qty };
  }).filter(row => row.qty > 0);
  const remaining = Object.fromEntries(rows.map(row => [row.src, row.qty]));
  const placed = Object.fromEntries(rows.map(row => [row.src, 0]));
  const targets = scope === 'current' ? [sheetIndex]
    : [sheetIndex, ...nest.sheets.map((_, i) => i).filter(i => i !== sheetIndex)];
  const addToSheet = sheet => {
    const fitOptions = { ...opts, acceptCandidate: (part, placed) =>
      (!opts.hasGrain || part.rotation === 0) && (!opts.acceptCandidate || opts.acceptCandidate(part, placed)) };
    const got = fitSalvage(sheet, fitOptions, rows, remaining);
    sheet.placements.push(...got);
    for (const p of got) { placed[p.src]++; remaining[p.src]--; }
    return got.length;
  };
  for (const index of targets) addToSheet(nest.sheets[index]);
  let addedSheets = 0;
  if (scope === 'extend') while (Object.values(remaining).some(q => q > 0)) {
    const sheet = { layers: [], placements: [] };
    if (!addToSheet(sheet)) break; // A chosen part cannot fit even on an empty sheet.
    nest.sheets.push(sheet);
    addedSheets++;
  }
  return { requested: rows.reduce((n, row) => n + row.qty, 0),
    placed: rows.reduce((n, row) => n + placed[row.src], 0),
    remaining, byPart: placed, addedSheets };
}
