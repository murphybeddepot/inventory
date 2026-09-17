// Display geometry only. OPT locations are CCW in a Y-up sheet frame.
// The drill/label datum uses the long side as X: W>L is normalized CCW 90,
// so its (0,0) is the source's (0,W). Keep that datum with the source outline.
const attr = (s,k) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
const near = (a,b) => Math.abs(a-b) < .06;
const identity = p => `${p.partNum}|${p.name}|${p.L}x${p.W}x${p.thickness}`;
export function readPartGeometry(source) {
  const l=Number(source?.L),w=Number(source?.W);
  const fail=error=>({l,w,error});
  if(!(l>0&&w>0))return fail('Missing source dimensions');
  const shape=String(source.raw||'').match(/<PartShapeXml\b[\s\S]*?<\/PartShapeXml>/)?.[0];
  if(!shape)return fail('No imported part outline');
  const tags=[...shape.matchAll(/<ShapePoint\b[^>]*>/g)].map(m=>m[0]);
  if(tags.some(t=>Number(attr(t,'PtType')||0)!==0))return fail('Curved outline needs a supported arc drawing');
  const outline=tags.map(t=>[Number(attr(t,'X')),Number(attr(t,'Y'))]);
  if(outline.length<3||outline.some(p=>p.some(v=>!Number.isFinite(v))))return fail('Invalid source outline');
  if(outline.some(([x,y])=>x<-.06||y<-.06||x>l+.06||y>w+.06))return fail('Outline exceeds source dimensions');
  return {l,w,outline};
}
// Same exact identity and occurrence order as the .moz exporter. A code alone
// is not enough: different sizes or differently shaped twins may share it.
export function geometryForStack(snapshot) {
  const sources=new Map();
  for(const p of snapshot.importedParts||[]){const k=identity(p);if(!sources.has(k))sources.set(k,[]);sources.get(k).push(p);}
  return (snapshot.layers||[]).map(layer=>layer.map(p=>readPartGeometry(sources.get(identity(p))?.shift())));
}
export function turnOptPoint([x,y],l,w,rotation=0) {
  const r=((Number(rotation)%360)+360)%360;
  switch(r){case 0:return[x,y];case 90:return[w-y,x];case 180:return[l-x,w-y];case 270:return[y,l-x];default:throw Error('Unsupported nest rotation');}
}
const poolKey = p => `${p.name}|${Math.round(p.l)}x${Math.round(p.w)}`;
// Match in the exact sheet/placement order used by buildOptFiles. Do not
// mutate placements, their rotation, saved nests, or their source geometry.
export function resolveNestGeometry(nest,parts=[],salvageSource=()=>null) {
  const pool=new Map(),result=new Map();
  for(const p of parts){const k=poolKey(p);if(!pool.has(k))pool.set(k,[]);pool.get(k).push(p.geometry);}
  for(const sh of nest.sheets||[])for(const p of sh.placements||[]){
    let g;
    if(p.remnant)g={l:p.l,w:p.w,outline:[[0,0],[p.l,0],[p.l,p.w],[0,p.w]],remnant:true};
    else if(p.salvage)g=readPartGeometry(salvageSource(p));
    else g=pool.get(poolKey(p))?.shift();
    result.set(p,g||{error:'No matching imported part outline'});
  }
  return result;
}
export function geometryOnSheet(p,source) {
  if(source?.error)return {error:source.error};
  if(!source?.outline)return {error:'No imported part outline'};
  const {l,w,outline}=source;
  if(!near(p.l,l)||!near(p.w,w))return {error:'Nest and source dimensions disagree'};
  if(p.flipped)return {error:'Flipped reference frame is not verified'};
  try{
    const turn=point=>{const [x,y]=turnOptPoint(point,l,w,p.rotation||0);return[x+Number(p.x),y+Number(p.y)];};
    const points=outline.map(turn);
    const cutEdges=outline.flatMap((a,i)=>{
      const b=outline[(i+1)%outline.length];
      const border=(near(a[0],0)&&near(b[0],0))||(near(a[0],l)&&near(b[0],l))||(near(a[1],0)&&near(b[1],0))||(near(a[1],w)&&near(b[1],w));
      return border?[]:[[turn(a),turn(b)]];
    });
    const reference=source.remnant?null:turn([0,w>l?w:0]);
    const fence=reference?[reference,turn(w>l?[0,0]:[l,0])]:null;
    const corners=[[0,0],[l,0],[l,w],[0,w]];
    const absent=corners.filter(c=>!outline.some(p=>near(p[0],c[0])&&near(p[1],c[1])));
    const orthogonal=outline.every((a,i)=>{const b=outline[(i+1)%outline.length];return near(a[0],b[0])||near(a[1],b[1]);});
    // A six-vertex rectangular corner cutout is the base-notch profile.
    // Zac + Shane: prefer the long edge THROUGH REF, including REF itself.
    const notch=outline.length===6&&orthogonal&&absent.length===1
      ?{atFence:near(w>l?absent[0][0]:absent[0][1],0),corner:turn(absent[0])}:null;
    const rot=((Number(p.rotation||0)%360)+360)%360, width=rot%180?w:l,height=rot%180?l:w;
    const corner=reference?(near(reference[1],p.y+height)?'top':'bottom')+'-'+(near(reference[0],p.x)?'left':'right'):null;
    return {points,cutEdges,reference,corner,fence,notch};
  }catch(err){return {error:err.message};}
}
