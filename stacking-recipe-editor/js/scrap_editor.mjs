import { partBox } from './nest.mjs?v=4.43';
import { Raster, planScrap, orderForTravel, rapidTravel } from './scrap_geometry.mjs?v=4.43';

import {cutRoutes,routeLines} from './scrap_routes.mjs?v=4.43';
import {afterOutlineRoutes,validateGrooveRoutes,checkScrapPhase} from './scrap_after.mjs?v=4.43';

export const SCRAP_DEFAULTS={bitDiameterMM:9.525,skinMM:.3,clearanceMM:6,maxPieceMM:304.8,minPieceMM:50.8};
const rounded=n=>Math.round(n*1000)/1000;
export function layoutStamp(sheet,nest) {
  return JSON.stringify([nest.sheetL,nest.sheetW,(sheet.placements||[]).map(p=>[p.name,p.layer,p.x,p.y,p.l,p.w,p.rotation||0])]);
}
export function editorPost(sheet,nest,settings=SCRAP_DEFAULTS) {
  const r=settings.bitDiameterMM/2;
  const parts=sheet.placements.map(p=>{const [a,c,b,d]=partBox(p);return {id:p.name,box:[a,b,c,d]};});
  const contours=parts.map(({box:[a,b,c,d]})=>[[a-r,b-r,c+r,b-r],[c+r,b-r,c+r,d+r],[c+r,d+r,a-r,d+r],[a-r,d+r,a-r,b-r]]);
  return {parts,contours,radius:r,width:nest.sheetL,height:nest.sheetW};
}
export function cutProblems(lines,post,settings=SCRAP_DEFAULTS) {
  const out=[],r=post.radius,clear=settings.clearanceMM;
  if(settings.maxPieceMM!==304.8||settings.minPieceMM!==50.8)return ['Scrap limits are 12 inches maximum X/Y and 2 inches minimum width.'];
  if(!(r>0)||!Number.isFinite(clear)||clear<3||clear>25||!Number.isFinite(settings.skinMM)||settings.skinMM<.2||settings.skinMM>2)return ['Skin must be 0.2-2 mm and part clearance 3-25 mm.'];
  if(!Array.isArray(lines))return ['Cut list is unreadable.'];
  for (const [i,s] of lines.entries()) {
    if(!Array.isArray(s)||s.length!==4||!s.every(Number.isFinite)){out.push(`Cut ${i+1}: invalid coordinates.`);continue;}
    const [x,y,a,b]=s;
    if(Math.abs(x-a)>.003&&Math.abs(y-b)>.003)out.push(`Cut ${i+1}: use a horizontal or vertical line.`);
    if(Math.hypot(a-x,b-y)<2*r-.01)out.push(`Cut ${i+1}: shorter than the bit diameter.`);
    if(Math.min(x,a)<-r-.01||Math.max(x,a)>post.width+r+.01||Math.min(y,b)<-r-.01||Math.max(y,b)>post.height+r+.01)out.push(`Cut ${i+1}: outside the sheet cutting envelope.`);
    const box=[Math.min(x,a)-r,Math.min(y,b)-r,Math.max(x,a)+r,Math.max(y,b)+r];
    for(const p of post.parts){const [u,v,c,d]=p.box;
      if(Math.max(u-box[2],box[0]-c,v-box[3],box[1]-d)<clear-.01){out.push(`Cut ${i+1}: too close to ${p.id}.`);break;}
    }
  }
  return out;
}
export function analyzeCuts(lines,post,settings=SCRAP_DEFAULTS) {
  const errors=cutProblems(lines,post,settings);
  if(errors.length)return {errors,pieces:[],oversize:[],slivers:[],cutLength:0,rapid:0};
  const raster=new Raster(post.width,post.height);
  for(const {box} of post.parts)raster.clear(...box);
  for(const line of post.contours.flat())raster.sweep(line,post.radius);
  for(const line of lines)raster.sweep(line,post.radius);
  // No morphological opening / ribbon exemption here. Narrow standing waste
  // remains visible; cutting it into many small pieces is not a passing result.
  const describe=k=>{
    const [a,b,c,d]=k.box,r=post.radius;
    return {box:k.box,area:k.area,width:Math.min(post.width,c+r)-Math.max(0,a-r),height:Math.min(post.height,d+r)-Math.max(0,b-r)};
  };
  const pieces=raster.islands().map(describe);
  const oversize=pieces.filter(p=>Math.max(p.width,p.height)>settings.maxPieceMM);
  const opened=raster.opened(raster.material,settings.minPieceMM+1.2);
  const narrow=raster.material.map((v,i)=>v&&!opened[i]?1:0);
  // Measure narrow arms/corridors as well as wholly narrow islands. A broad
  // bounding box cannot conceal a one-inch tail attached to a large offcut.
  const slivers=raster.islands(narrow).map(describe);
  // A 2 mm raster can erase a 1.95 mm ribbon (21 mm between finished edges
  // with a 9.525 mm bit). Conservatively flag sub-grid corridors and edge
  // strips analytically. Crosscutting such a ribbon is not a width fix.
  // These checks supplement the model; they never establish a release pass.
  const D=2*post.radius;
  const tiny=(box)=>{
    const width=box[2]-box[0],height=box[3]-box[1];
    if(Math.min(width,height)>.001&&Math.min(width,height)<2&&Math.max(width,height)>=settings.minPieceMM)
      slivers.push({box,area:width*height,width,height,subGrid:true});
  };
  for(const p of post.parts){const [a,b,c,d]=p.box;
    tiny([0,b,a-D,d]);tiny([c+D,b,post.width,d]);
    tiny([a,0,c,b-D]);tiny([a,d+D,c,post.height]);
  }
  for(let i=0;i<post.parts.length;i++)for(let j=i+1;j<post.parts.length;j++)for(const axis of [0,1]){
    const A=post.parts[i].box,B=post.parts[j].box,cross=1-axis;
    const [lo,hi]=A[axis]<=B[axis]?[A,B]:[B,A];
    const gap=hi[axis]-lo[axis+2]-2*D;
    if(gap<=.001||gap>=2)continue;
    const u=Math.max(lo[cross],hi[cross]),v=Math.min(lo[cross+2],hi[cross+2]);
    if(v-u<settings.minPieceMM)continue;
    tiny(axis===0?[lo[2]+D,u,hi[0]-D,v]:[u,lo[3]+D,v,hi[1]-D]);
  }
  // Exact strip checks also cover hand-drawn cuts: the raster can erase a
  // sub-2mm ribbon between a cut and a native contour (or another cut).
  for(const [i,line] of lines.entries())if(createsNarrowStrip(line,post,settings,lines.filter((_,j)=>j!==i))){
    const box=[Math.min(line[0],line[2])-post.radius,Math.min(line[1],line[3])-post.radius,Math.max(line[0],line[2])+post.radius,Math.max(line[1],line[3])+post.radius];
    slivers.push({box,width:box[2]-box[0],height:box[3]-box[1],area:0,cutWarning:true,reason:`Cut ${i+1} can leave a narrow strip beside a part, sheet edge or other cut.`});
  }
  return {errors,pieces,oversize,slivers,cutLength:lines.reduce((n,s)=>n+Math.hypot(s[2]-s[0],s[3]-s[1]),0),rapid:rapidTravel(lines,[0,0])};
}
export function normalizeCuts(lines,post=null,settings=SCRAP_DEFAULTS) {
  const pending=lines.map(s=>s.map(rounded));
  // Join endpoints that stop inside an existing perpendicular kerf. The tiny
  // extension stays inside that already-cut band and must also clear parts.
  if(post)for(const a of pending)for(const endpoint of [0,2])for(const b of pending){
    if(a===b)continue;
    const vertical=Math.abs(a[0]-a[2])<.003,otherVertical=Math.abs(b[0]-b[2])<.003;
    if(vertical===otherVertical)continue;
    const t=vertical?1:0,f=1-t,target=b[t],lo=Math.min(b[f],b[f+2]),hi=Math.max(b[f],b[f+2]);
    if(a[f]<lo||a[f]>hi||Math.abs(target-a[t+endpoint])>post.radius)continue;
    // Extend outward only; never shorten or erase a planned cut.
    const other=a[t+(2-endpoint)],at=a[t+endpoint];
    if((at-other)*(target-at)<0)continue;
    const candidate=[...a];candidate[t+endpoint]=target;
    if(!cutProblems([candidate],post,settings).length)a.splice(0,4,...candidate);
  }
  let merged=true;
  while(merged){merged=false;
    outer:for(let i=0;i<pending.length;i++)for(let j=i+1;j<pending.length;j++){
      const a=pending[i],b=pending[j],va=Math.abs(a[0]-a[2])<.003,vb=Math.abs(b[0]-b[2])<.003;
      const f=va?0:1,t=1-f;if(va!==vb||Math.abs(a[f]-b[f])>.003)continue;
      const lo=Math.min(a[t],a[t+2]),hi=Math.max(a[t],a[t+2]),u=Math.min(b[t],b[t+2]),v=Math.max(b[t],b[t+2]);
      if(Math.max(lo,u)>Math.min(hi,v)+.003)continue;
      pending[i]=va?[a[0],Math.min(lo,u),a[0],Math.max(hi,v)]:[Math.min(lo,u),a[1],Math.max(hi,v),a[1]];
      pending.splice(j,1);merged=true;break outer;
    }
  }
  return orderForTravel(pending,[0,0]);
}
export function suggestCuts(sheet,nest,settings=SCRAP_DEFAULTS) {
  const post=editorPost(sheet,nest,settings);
  // Leave narrow waste intact and report it below. Never make dust to hide it.
  let lines=[];
  try{lines=planScrap(post,{skin:settings.skinMM,maxInches:(settings.maxPieceMM-4)/25.4,ribbonInches:2,narrowInches:2,clearance:settings.clearanceMM}).lines;}
  catch(e){if(!/^(Nothing to cut|\d+ piece\(s\) still over|A scrap cut comes within)/.test(e.message))throw e;}
  const repair=improveSuggestion(lines,post,settings);
  return {version:1,settings:{...settings},layout:layoutStamp(sheet,nest),lines:repair.lines,
    suggestion:repair.summary};
}
// Inspect actual local strips, not just an offcut's broad bounding box.
// A cut parallel to a finished edge must either merge with the native kerf
// or retain at least two inches of waste. More crosscuts cannot fix its width.
export function createsNarrowStrip(line,post,settings=SCRAP_DEFAULTS,other=[]){
  const axis=Math.abs(line[0]-line[2])<.003?0:1,t=1-axis,r=post.radius,D=2*r;
  const fixed=line[axis],lo=Math.min(line[t],line[t+2]),hi=Math.max(line[t],line[t+2]);
  const narrow=v=>v>.01&&v<settings.minPieceMM+2;
  if(narrow(fixed-r)||narrow((axis?post.height:post.width)-fixed-r))return true;
  for(const {box:b} of post.parts){
    if(Math.min(hi,b[t+2])-Math.max(lo,b[t])<D)continue;
    const gap=fixed<b[axis]?b[axis]-fixed-D-r:fixed>b[axis+2]?fixed-b[axis+2]-D-r:0;
    if(narrow(gap))return true;
  }
  for(const s of other){
    if((Math.abs(s[0]-s[2])<.003?0:1)!==axis)continue;
    if(Math.min(hi,Math.max(s[t],s[t+2]))-Math.max(lo,Math.min(s[t],s[t+2]))>=D&&narrow(Math.abs(s[axis]-fixed)-D))return true;
  }
  return false;
}
function wasteGrid(lines,post){
  const raster=new Raster(post.width,post.height);
  for(const {box} of post.parts)raster.clear(...box);
  for(const l of post.contours.flat())raster.sweep(l,post.radius);
  for(const l of lines)raster.sweep(l,post.radius);
  return raster;
}
export function narrowMask(lines,post,settings=SCRAP_DEFAULTS){
  const r=wasteGrid(lines,post),opened=r.opened(r.material,settings.minPieceMM+1.2);
  return r.material.map((v,i)=>v&&!opened[i]?1:0);
}
export function introducedNarrowCells(before,after){let count=0;for(let i=0;i<after.length;i++)if(after[i]&&!before[i])count++;return count;}
export function layoutWasteIssues(post,settings=SCRAP_DEFAULTS){
  const issues=[],seen=new Set(),D=2*post.radius;
  for(let i=0;i<post.parts.length;i++)for(let j=i+1;j<post.parts.length;j++)for(const axis of [0,1]){
    const a=post.parts[i],b=post.parts[j],t=1-axis;
    const [lo,hi]=a.box[axis]<=b.box[axis]?[a,b]:[b,a];
    if(Math.min(lo.box[t+2],hi.box[t+2])-Math.max(lo.box[t],hi.box[t])<settings.minPieceMM)continue;
    const width=hi.box[axis]-lo.box[axis+2]-2*D;
    if(width<=.01||width>=settings.minPieceMM)continue;
    const key=[lo.id,hi.id,width.toFixed(1)].join('/');if(seen.has(key))continue;seen.add(key);
    issues.push({a:lo.id,b:hi.id,width:rounded(width)});
  }
  return issues;
}
export function improveSuggestion(seed,post,settings=SCRAP_DEFAULTS){
  const baseNarrow=narrowMask([],post,settings),r=post.radius;
  let lines=[],rejected=0;
  const safe=candidate=>!cutProblems(candidate,post,settings).length
    &&candidate.every((l,i)=>!createsNarrowStrip(l,post,settings,candidate.filter((_,j)=>i!==j)))
    &&!introducedNarrowCells(baseNarrow,narrowMask(candidate,post,settings));
  for(const l of seed){if(safe([...lines,l]))lines.push(l);else rejected++;}
  const measure=ls=>wasteGrid(ls,post).islands().map(p=>({...p,cells:undefined}));
  const over=p=>Math.max(p.box[2]-p.box[0],p.box[3]-p.box[1])+2*r>settings.maxPieceMM;
  const score=ps=>ps.reduce((n,p)=>n+(over(p)?p.area:0),0);
  // Split along a real free corridor, clipped around every part keepout.
  // Try the midpoint first, then offsets that leave a full 2in beside parts.
  const spans=(axis,fixed,box)=>{
    const t=1-axis,pad=r+settings.clearanceMM;
    let ranges=[[Math.max(-r,box[t]-r),Math.min((t?post.height:post.width)+r,box[t+2]+r)]];
    for(const {box:b} of post.parts){
      if(fixed<b[axis]-pad||fixed>b[axis+2]+pad)continue;
      ranges=ranges.flatMap(([lo,hi])=>b[t+2]+pad<=lo||b[t]-pad>=hi?[[lo,hi]]:[[lo,Math.min(hi,b[t]-pad)],[Math.max(lo,b[t+2]+pad),hi]].filter(([a,b])=>b>a));
    }
    return ranges.filter(([lo,hi])=>hi-lo>=settings.minPieceMM+2*r).map(([lo,hi])=>(axis?[lo,fixed,hi,fixed]:[fixed,lo,fixed,hi]).map(rounded));
  };
  let pieces=measure(lines),budget=90;
  for(let round=0;round<24&&budget>0;round++){
    const oldScore=score(pieces);if(!oldScore)break;let best=null;
    for(const p of pieces.filter(over).sort((a,b)=>b.area-a.area)){
      const b=p.box;if(Math.min(b[2]-b[0],b[3]-b[1])<settings.minPieceMM)continue;
      const axes=[0,1].sort((a,c)=>(b[c+2]-b[c])-(b[a+2]-b[a]));
      for(const axis of axes){
        const center=(b[axis]+b[axis+2])/2,offset=settings.minPieceMM+3*r+4;
        const candidates=[center,...post.parts.flatMap(p=>[p.box[axis]-offset,p.box[axis+2]+offset])]
          .filter(v=>v>b[axis]+settings.minPieceMM+r&&v<b[axis+2]-settings.minPieceMM-r)
          .sort((a,c)=>Math.abs(a-center)-Math.abs(c-center));
        for(const fixed of [...new Set(candidates.map(rounded))].slice(0,5)){
          const added=spans(axis,fixed,b);if(!added.length)continue;
          const proposal=[...lines,...added];
          if(added.some(l=>createsNarrowStrip(l,post,settings,lines))||cutProblems(proposal,post,settings).length)continue;
          if(--budget<0)break;
          const ps=measure(proposal),gain=oldScore-score(ps);if(gain<=0||!safe(proposal))continue;
          const cost=added.length*2000+added.reduce((n,s)=>n+Math.hypot(s[2]-s[0],s[3]-s[1]),0);
          if(!best||gain/cost>best.value)best={lines:proposal,pieces:ps,value:gain/cost};
        }
      }
      if(best||budget<=0)break;
    }
    if(!best)break;lines=best.lines;pieces=best.pieces;
  }
  const normalized=normalizeCuts(lines,post,settings);if(safe(normalized))lines=normalized;
  const report=analyzeCuts(lines,post,settings);
  return {lines,summary:{rejectedCuts:rejected,oversize:report.oversize.length,slivers:report.slivers.length,
    layoutIssues:layoutWasteIssues(post,settings),needsLayoutChanges:baseNarrow.some(Boolean),complete:!report.errors.length&&!report.oversize.length&&!report.slivers.length}};
}
const geometryKey=lines=>JSON.stringify(normalizeCuts(lines).map(l=>{
  const a=l.slice(0,2),b=l.slice(2);return JSON.stringify(a)<JSON.stringify(b)?l:[...b,...a];
}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function plannedRoutes(edit,post=null){
  const phase=checkScrapPhase(edit);
  if(post&&phase==='after-outlines'){
    if(edit.routes){validateGrooveRoutes(edit.routes,edit.lines,post);return structuredClone(edit.routes);}
    return afterOutlineRoutes(normalizeCuts(edit.lines),post,{skin:edit.settings?.skinMM??.3,finish:[0,post.height/2]});
  }
  if(!edit.routes)return cutRoutes(normalizeCuts(edit.lines));
  if(!Array.isArray(edit.routes)||edit.routes.some(p=>!Array.isArray(p)||p.length<2||p.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite))))throw Error('Cut order is unreadable. Use Auto order again.');
  if(geometryKey(routeLines(edit.routes))!==geometryKey(edit.lines))throw Error('Cut order no longer matches the cuts. Use Auto order again.');
  return structuredClone(edit.routes);
}
export function exportCutPlans(nest) {
  return nest.sheets.flatMap((sheet,i)=>{
    const edit=sheet.scrapCuts;if(!edit)return [];
    if(edit.layout!==layoutStamp(sheet,nest))throw Error(`Sheet ${i+1}: parts changed after its scrap cuts were checked. Open Scrap cuts and recheck them.`);
    const settings={...SCRAP_DEFAULTS,...edit.settings},post=editorPost(sheet,nest,settings);
    const report=analyzeCuts(edit.lines,post,settings);
    if(report.errors.length)throw Error(`Sheet ${i+1}: ${report.errors[0]}`);
    if(report.oversize.length||report.slivers.length)throw Error(`Sheet ${i+1}: scrap plan still has ${report.oversize.length} oversized piece(s) and ${report.slivers.length} narrow piece(s). Edit cuts or spacing before exporting this plan.`);
    const routes=plannedRoutes(edit,post),phase=checkScrapPhase(edit);
    return [{sheet:i+1,frame:'nest-xy',width:post.width,height:post.height,parts:post.parts,settings,phase,finishTarget:'left-middle',orderMode:edit.routes?'manual':'automatic',lines:normalizeCuts(edit.lines),routes}];
  });
}
