// Display geometry only. OPT locations are CCW in a Y-up sheet frame.
// The drill/label datum uses the long side as X: W>L is normalized CCW 90,
// so its (0,0) is the source's (0,W). Keep that datum with the source outline.
const attr = (s,k) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
const near = (a,b) => Math.abs(a-b) < .06;
const identity = p => `${p.partNum}|${p.name}|${p.L}x${p.W}x${p.thickness}`;
// A verified feed frame may deliberately keep the short dimension as drill X.
// This is a datum rotation only: no outline, hole, banded edge or face moves.
export function explicitDrillFrameCW(p) {
  const value=p?.drillFrameCW ?? p?.geometry?.drillFrameCW;
  if(value===undefined || value===null)return undefined;
  const n=Number(value);
  if(n!==0 && n!==90)throw Error('Unsupported explicit drill frame; expected verified CW 0 or 90.');
  return n;
}
function frameCW(p) {
  const explicit=explicitDrillFrameCW(p);
  return explicit===undefined ? (Number(p?.w??p?.W)>Number(p?.l??p?.L)?270:0) : explicit;
}
function framePoints(l,w,cw) {
  if(cw===90)return {L:w,W:l,toDrill:([x,y])=>[y,l-x],fromDrill:([x,y])=>[l-y,x]};
  if(cw===270)return {L:w,W:l,toDrill:([x,y])=>[w-y,x],fromDrill:([x,y])=>[y,w-x]};
  return {L:l,W:w,toDrill:p=>p,fromDrill:p=>p};
}
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
  const drillFrameCW=explicitDrillFrameCW(source);
  return {l,w,outline,...(drillFrameCW===undefined?{}:{drillFrameCW})};
}
// Same exact identity and occurrence order as the .moz exporter. A code alone
// is not enough: different sizes or differently shaped twins may share it.
export function geometryForStack(snapshot) {
  const sources=new Map();
  for(const p of snapshot.importedParts||[]){const k=identity(p);if(!sources.has(k))sources.set(k,[]);sources.get(k).push(p);}
  return (snapshot.layers||[]).map(layer=>layer.map(p=>{
    const source=sources.get(identity(p))?.shift(),policy=snapshot.drillFramePolicy;
    const rule=policy?.explicitParts?.find(q=>q.code===p.partNum && (q.sourceL===undefined||near(q.sourceL,p.L)) && (q.sourceW===undefined||near(q.sourceW,p.W)));
    const specified=[explicitDrillFrameCW(p),explicitDrillFrameCW(source),rule?.drillFrameCW].filter(v=>v!==undefined);
    if(new Set(specified.map(Number)).size>1)throw Error(`${p.partNum}: source, placement and verified drill-frame policy disagree.`);
    const value=specified[0]??policy?.allUnlistedParts?.drillFrameCW;
    return readPartGeometry(value===undefined?source:{...source,drillFrameCW:value});
  }));
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
  for(const p of parts){const k=poolKey(p);if(!pool.has(k))pool.set(k,[]);pool.get(k).push(p);}
  for(const sh of nest.sheets||[])for(const p of sh.placements||[]){
    let g;
    if(p.remnant)g={l:p.l,w:p.w,outline:[[0,0],[p.l,0],[p.l,p.w],[0,p.w]],remnant:true};
    else if(p.salvage)g=readPartGeometry(salvageSource(p));
    else {
      const candidates=pool.get(poolKey(p))||[];
      const exact=candidates.findIndex(q=>Number(q.sourceLayer??q.layer)===Number(p.sourceLayer??p.layer));
      g=(exact>=0?candidates.splice(exact,1)[0]:candidates.shift())?.geometry;
    }
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
    const frame=framePoints(l,w,frameCW(source));
    const reference=source.remnant?null:turn(frame.fromDrill([0,0]));
    const fence=reference?[reference,turn(frame.fromDrill([frame.L,0]))]:null;
    const corners=[[0,0],[l,0],[l,w],[0,w]];
    const absent=corners.filter(c=>!outline.some(p=>near(p[0],c[0])&&near(p[1],c[1])));
    const orthogonal=outline.every((a,i)=>{const b=outline[(i+1)%outline.length];return near(a[0],b[0])||near(a[1],b[1]);});
    // A six-vertex rectangular corner cutout is the base-notch profile.
    // Zac + Shane: prefer the long edge THROUGH REF, including REF itself.
    const notch=outline.length===6&&orthogonal&&absent.length===1
      ?{atFence:near(frame.toDrill(absent[0])[1],0),corner:turn(absent[0])}:null;
    const rot=((Number(p.rotation||0)%360)+360)%360, width=rot%180?w:l,height=rot%180?l:w;
    const corner=reference?(near(reference[1],p.y+height)?'top':'bottom')+'-'+(near(reference[0],p.x)?'left':'right'):null;
    return {points,cutEdges,reference,corner,fence,notch};
  }catch(err){return {error:err.message};}
}

// The drill needs a continuous long edge opposite REF. The router nest also
// keeps material at its top-right corner. Translate positions freely, but
// exclude rotations that put a corrected bottom-right notch at top-right.
// Native OPT is CCW; the operator sees CW relative to the normalized drill datum.
export function drillFrameRotations(p) {
  const zero=(360-frameCW(p))%360;
  return [zero,(zero+270)%360];
}
export function clockwiseDrillRotation(p,rotation=p.rotation||0) {
  const zero=drillFrameRotations(p)[0];
  return ((zero-Number(rotation))%360+360)%360;
}
export function sensorRotations(g) {
  if (!g?.outline || g.outline.length <= 4) return drillFrameRotations(g);
  const {l,w,outline} = g,frame=framePoints(l,w,frameCW(g)),{L,W}=frame;
  const drill=outline.map(frame.toDrill);
  const spans=drill.flatMap((a,i)=>{
    const b=drill[(i+1)%drill.length];
    return near(a[1],W)&&near(b[1],W)?[[Math.min(a[0],b[0]),Math.max(a[0],b[0])]]:[];
  }).sort((a,b)=>a[0]-b[0]);
  let end=0;
  for(const [a,b] of spans){if(a>end+.05)break;end=Math.max(end,b);}
  if(end<L-.05) throw Error('Base notch is opposite REF. Correct the master and reimport it before nesting.');
  return drillFrameRotations(g).filter(rotation=>outline.map(p=>turnOptPoint(p,l,w,rotation))
    .some(([x,y])=>near(x,rotation%180?w:l)&&near(y,rotation%180?l:w)));
}
