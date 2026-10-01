// Fast, local dimensions for a cut being dragged. These are drawing estimates;
// the posted toolpath and complete waste-island review remain release gates.
export function nearbyCutGaps(line, lines, post, selected = -1) {
  if (!line || !post) return [];
  const vertical = Math.abs(line[0] - line[2]) < 0.003;
  const axis = vertical ? 0 : 1;
  const cross = 1 - axis;
  const at = (line[axis] + line[axis + 2]) / 2;
  const low = Math.min(line[cross], line[cross + 2]);
  const high = Math.max(line[cross], line[cross + 2]);
  const radius = post.radius || 0;
  const limit = axis === 0 ? post.width : post.height;
  const candidates = [
    {at: 0, type: 'cutting edge', id: 'near edge', sweep: 0},
    {at: limit, type: 'cutting edge', id: 'far edge', sweep: 0},
  ];
  for (const [i, other] of lines.entries()) {
    if (i === selected || !Array.isArray(other) || other.length !== 4) continue;
    if (Math.abs(other[axis] - other[axis + 2]) >= 0.003) continue;
    if (Math.max(low, Math.min(other[cross], other[cross + 2])) >=
        Math.min(high, Math.max(other[cross], other[cross + 2]))) continue;
    candidates.push({at: (other[axis] + other[axis + 2]) / 2,
      type: 'scrap cut', id: `cut ${i + 1}`, sweep: radius});
  }
  for (const part of post.parts || []) {
    const box = part.box;
    if (!box || Math.max(low, box[cross]) >= Math.min(high, box[cross + 2])) continue;
    candidates.push({at: box[axis], type: 'part', id: part.id, sweep: radius});
    candidates.push({at: box[axis + 2], type: 'part', id: part.id, sweep: radius});
  }
  return [-1, 1].map(side => {
    const nearest = candidates.filter(c => side * (c.at - at) > 0.003)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
    if (!nearest) return null;
    const center = Math.abs(nearest.at - at);
    const clear = Math.max(0, center - radius - nearest.sweep);
    return {side, axis, at, otherAt: nearest.at, centerMM: center,
      clearMM: clear, id: nearest.id, type: nearest.type,
      status: clear < 50.8 ? 'too narrow' : clear > 304.8 ? 'over 12 inches' : 'within range'};
  }).filter(Boolean);
}
