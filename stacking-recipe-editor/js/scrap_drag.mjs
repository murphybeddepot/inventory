import { cutProblems } from './scrap_editor.mjs?v=4.52';

// Magnetize a drawn or edited endpoint to a crossing cut only when that
// exact intersection remains clear of finished parts.
export function snapCutIntersection(original, endpoint, desired, post, settings, otherLines = [], snapRadius = 18) {
  const axis = Math.abs(original[0] - original[2]) < .003 ? 1 : 0;
  const coordinate = axis + endpoint * 2;
  const candidate = [...original];
  const fixed = original[1 - axis];
  const crossings = otherLines.filter(line => {
    const otherAxis = Math.abs(line[0] - line[2]) < .003 ? 1 : 0;
    const lo = Math.min(line[1 - axis], line[3 - axis]);
    const hi = Math.max(line[1 - axis], line[3 - axis]);
    return otherAxis !== axis && fixed >= lo - post.radius && fixed <= hi + post.radius;
  }).map(line => line[axis]);
  const nearest = crossings.reduce((best, at) => Math.abs(at - desired) < Math.abs(best - desired) ? at : best, Infinity);
  if (Number.isFinite(nearest) && Math.abs(nearest - desired) <= snapRadius) {
    candidate[coordinate] = nearest;
    if (!cutProblems([candidate], post, settings).length) return candidate;
  }
  return null;
}

export function snapCutEndpoint(original, endpoint, desired, post, settings, otherLines = [], snapRadius = 18) {
  const axis = Math.abs(original[0] - original[2]) < .003 ? 1 : 0;
  const coordinate = axis + endpoint * 2;
  const intersection = snapCutIntersection(original, endpoint, desired, post, settings, otherLines, snapRadius);
  if (intersection) return intersection;
  const candidate = [...original];
  candidate[coordinate] = desired;
  if (!cutProblems([candidate], post, settings).length) return candidate;
  if (cutProblems([original], post, settings).length) return null;
  const start = original[coordinate];
  let safe = 0, blocked = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (safe + blocked) / 2;
    candidate[coordinate] = start + (desired - start) * mid;
    if (cutProblems([candidate], post, settings).length) blocked = mid;
    else safe = mid;
  }
  candidate[coordinate] = start + (desired - start) * safe;
  return candidate;
}

// When the body of a line is dragged toward a part, stop the whole line at
// the last safe parallel position instead of restoring it to its old place.
export function snapCutTranslation(original, distance, axis, post, settings) {
  const moved = fraction => original.map((value, i) => i % 2 === axis
    ? value + distance * fraction : value);
  const target = moved(1);
  if (!cutProblems([target], post, settings).length) return target;
  if (cutProblems([original], post, settings).length) return null;
  let safe = 0, blocked = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (safe + blocked) / 2;
    if (cutProblems([moved(mid)], post, settings).length) blocked = mid;
    else safe = mid;
  }
  return moved(safe);
}
