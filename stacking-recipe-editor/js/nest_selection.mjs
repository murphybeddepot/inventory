// Selection uses placement identity, never a part name (names can repeat).
export function selectionBox(parts) {
  const boxes=parts.map(p=>{
    const turn=Number(p.rotation||0)%180!==0;
    return [p.x,p.y,p.x+(turn?p.w:p.l),p.y+(turn?p.l:p.w)];
  });
  return boxes.length ? [Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),
    Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))] : null;
}
export function marqueeParts(parts,start,end) {
  const [x0,x1]=[start.x,end.x].sort((a,b)=>a-b),[y0,y1]=[start.y,end.y].sort((a,b)=>a-b);
  if(x1-x0<.01||y1-y0<.01)return [];
  return parts.filter(p=>{const [a,b,c,d]=selectionBox([p]);return a<x1&&c>x0&&b<y1&&d>y0;});
}
// Clamp ONE translation for the entire group so relative offsets never change.
export function selectionDelta(parts,dx,dy,opts) {
  const bounds=selectionBox(parts);if(!bounds)return [0,0];
  const [x0,y0,x1,y1]=bounds,E=Number(opts.edge)||0;
  const round=v=>Math.round(v*10)/10;
  return [Math.max(E-x0,Math.min(round(dx),opts.sheetL-E-x1)),
    Math.max(E-y0,Math.min(round(dy),opts.sheetW-E-y1))];
}
