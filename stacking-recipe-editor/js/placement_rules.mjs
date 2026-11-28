const area = points => Math.abs(points.reduce((total,p,i) => {
  const q=points[(i+1)%points.length];
  return total+p[0]*q[1]-q[0]*p[1];
},0))/2;
function clip(points,axis,boundary,sign) {
  return points.flatMap((p,i)=>{
    const q=points[(i+1)%points.length];
    const pin=(p[axis]-boundary)*sign>=0, qin=(q[axis]-boundary)*sign>=0;
    if(pin===qin)return pin?[p]:[];
    const t=(boundary-p[axis])/(q[axis]-p[axis]);
    return [...(pin?[p]:[]),p.map((v,k)=>v+t*(q[k]-v))];
  });
}
function outline(p) {
  return p.geometry?.outline ?? [[0,0],[p.l,0],[p.l,p.w],[0,p.w]];
}
export const panelArea = p => area(outline(p));
export function anchorCandidates(parts) {
  const sorted=parts.map(panelArea).sort((a,b)=>b-a);
  const threshold=Math.max(sorted[0]*0.6,sorted[Math.min(2,sorted.length-1)]);
  return parts.filter(p=>panelArea(p)>=threshold-1e-8);
}
export function outsideFraction(p,o) {
  const points=outline(p).map(([x,y])=>{
    const turn=((p.rotation||0)%360+360)%360;
    const q=turn===90?[p.w-y,x]:turn===180?[p.l-x,p.w-y]:turn===270?[y,p.l-x]:[x,y];
    return [q[0]+p.x,q[1]+p.y];
  });
  const left=clip(clip(points,0,o.sheetL/2,-1),1,o.sheetW/3,-1);
  const right=clip(clip(points,0,o.sheetL/2,1),1,o.sheetW/2,-1);
  return (area(left)+area(right))/area(points);
}
export function cornerViolations(parts,o) {
  if(!parts.length || o.vacuumProfile!=='2026.09.18.1')return [];
  const candidates=anchorCandidates(parts);
  const fits=candidates.some(p=>{
    const w=(p.rotation||0)%180?p.w:p.l;
    return Math.abs(p.x+w-(o.sheetL-o.edge))<=0.2 && Math.abs(p.y-o.edge)<=0.2;
  });
  return fits?[]:[{a:candidates.map(p=>p.name).join(', '),b:'bottom-right corner',reason:'Place an eligible top-three panel at the bottom-right trim. Minimum area is 60% of the largest panel.',mm:0,gap:0,overlap:false}];
}
