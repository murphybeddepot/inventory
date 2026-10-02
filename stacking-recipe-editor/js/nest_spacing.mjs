import { partBox, nestViolations, smallPartBuffer } from './nest.mjs?v=4.55';

// Translate only: keep order, geometry, rotation, machining, grain and layers.
export function spacingPreview(sheet, selected, nest, axis, maxGapMM, bitDiameterMM=9.525, span='sheet') {
  if (!['x','y'].includes(axis)) throw Error('Choose row or column.');
  if (selected.length<2) throw Error('Select at least two parts in one row or column.');
  if (new Set(selected).size!==selected.length || selected.some(p=>!sheet.placements.includes(p))) throw Error('Selection must belong to this sheet.');
  if (!(bitDiameterMM>0) || !Number.isFinite(maxGapMM) || maxGapMM>=2*bitDiameterMM-.05)
    throw Error(`Maximum gap must be below ${(2*bitDiameterMM-.05).toFixed(3)} mm for this bit.`);
  const i=axis==='x'?0:2, cross=axis==='x'?2:0;
  const sorted=[...selected].sort((a,b)=>partBox(a)[i]-partBox(b)[i]);
  // All boxes must share a cross-axis band. A scattered selection is not a row.
  if (Math.min(...sorted.map(p=>partBox(p)[cross+1]))<=Math.max(...sorted.map(p=>partBox(p)[cross]))+.01)
    throw Error('Select parts in a single row or column; these parts do not share a common band.');
  if(!['sheet','selection'].includes(span))throw Error('Choose selected span or valid sheet span.');
  const edge=span==='selection'?Math.min(...sorted.map(p=>partBox(p)[i])):Number(nest.edge)||0;
  const end=span==='selection'?Math.max(...sorted.map(p=>partBox(p)[i+1])):(axis==='x'?nest.sheetL:nest.sheetW)-(Number(nest.edge)||0);
  const total=sorted.reduce((sum,p)=>{const b=partBox(p);return sum+b[i+1]-b[i];},0);
  const gap=(end-edge-total)/(sorted.length-1);
  // The explicit spacing operation can lower the normal gap, but cannot waive
  // an enabled small-part hold-down buffer or the physical cutter clearance.
  const minimum=Math.max(bitDiameterMM+.5,...sorted.map(p=>smallPartBuffer(p,nest)>0?Number(nest.smallPartSpacingMM):0));
  const excess=Math.max(0,(gap-maxGapMM)*(sorted.length-1));
  const problem=gap>maxGapMM+.001?`This span requires ${gap.toFixed(3)} mm gaps, above your ${maxGapMM} mm maximum. ${excess.toFixed(2)} mm cannot be absorbed; change the selection or its outer span.`
    :gap<minimum-.001?`This span requires ${gap.toFixed(3)} mm gaps; at least ${minimum.toFixed(3)} mm is required for this bit and the enabled small-part spacing.`:null;
  return {sorted,i,edge,end,gap,minimum,excess,problem,span};
}

export function distributeSelection(sheet, selected, nest, axis, maxGapMM, bitDiameterMM=9.525, groupId='distributed', span='sheet') {
  const {sorted,i,edge,gap,minimum,problem}=spacingPreview(sheet,selected,nest,axis,maxGapMM,bitDiameterMM,span);
  if(problem)throw Error(problem);
  let at=edge;const moved=new Map();
  for (const p of sorted) {
    const b=partBox(p),copy={...p,[axis]:Math.round(at*1000)/1000,_moved:true,
      spacingGroup:{id:groupId,bitDiameterMM,minGapMM:minimum}};
    moved.set(p,copy);at+=b[i+1]-b[i]+gap;
  }
  const placements=sheet.placements.map(p=>moved.get(p)||p);
  const bad=nestViolations({...nest,sheets:[{...sheet,placements}]});
  if(bad.length)throw Error('Spacing not applied: '+(bad[0].reason||`${bad[0].a}/${bad[0].b} would overlap or be too close.`));
  return {placements,gap,minimum,selected:sorted.map(p=>moved.get(p)),absorbedEdgeWaste:span==='sheet'};
}
