import {nestCutterDiameterMM} from './native_router_profile.mjs?v=4.64';
import { partBox } from './nest.mjs?v=4.64';
import {modelNativePlacement,segmentOutlineDistance} from './scrap_native_geometry.mjs?v=4.64';
import {retainedNarrowCorridors,hasWasteSquare,nativeTipConnected} from './scrap_waste_width.mjs?v=4.64';
import { Raster, orderForTravel, rapidTravel } from './scrap_geometry.mjs?v=4.64';

import {planAlignedWaste} from './scrap_grid.mjs?v=4.64';
import {cutRoutes,straightCutRoutes,routeLines} from './scrap_routes.mjs?v=4.64';
import {afterOutlineRoutes,validateGrooveRoutes,checkScrapPhase,estimateRouteTime} from './scrap_after.mjs?v=4.64';

export const SCRAP_DEFAULTS={phase:'before-outlines',bitDiameterMM:9.525,skinMM:.3,clearanceMM:6,maxPieceMM:304.8,minPieceMM:50.8};
export function scrapSettingsFor(sheet,nest){
  const diameter=nestCutterDiameterMM(nest);
  return {...SCRAP_DEFAULTS,...sheet?.scrapCuts?.settings,...(diameter?{bitDiameterMM:diameter}:{})};
}

const rounded=n=>Math.round(n*1000)/1000;
export function layoutStamp(sheet,nest) {
  return JSON.stringify([nest.sheetL,nest.sheetW,(sheet.placements||[]).map(p=>[p.name,p.layer,p.x,p.y,p.l,p.w,p.rotation||0,p.geometry||null])]);
}
// A native review can accept particular microscopic corner remnants. Keep that
// decision tied to the complete geometry and cutter plan, not a global toggle.
export function nativeWasteScope(sheet,nest) {
  const e=sheet.scrapCuts;
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  return JSON.stringify(canonical([String(nest.sku||nest.jobName||nest.job||''),JSON.parse(layoutStamp(sheet,nest)),e?.lines,e?.settings,e?.operations||[],nest.nativeRouterProfile||null]));
}
function acceptedNativeCrumb(issue,sheet,nest) {
  const a=sheet.scrapCuts?.nativeWasteAcceptance;
  if(issue.severity!=='warning'||!['resolution','native-crumb'].includes(issue.code)||a?.version!==1||a.action!=='accept-native-corner-crumbs'||a.decision!=='accepted'||!a.receipt?.reference||!a.acceptedAt||a.scope!==nativeWasteScope(sheet,nest))return false;
  if(!a.nativeEvidence?.sha256||!Array.isArray(a.fragments)||!a.fragments.length||!Array.isArray(a.warnings))return false;
  // This path is only for independently measured sub-two-millimetre crumbs.
  // Genuine strips, oversized pieces, clearance warnings and errors still
  // require their own review or the existing explicit warning override.
  if(a.fragments.some(p=>!Array.isArray(p.bounds)||p.bounds.length!==4||!p.bounds.every(Number.isFinite)||!(p.areaMM2>0)||p.areaMM2>4||p.bounds[2]<=p.bounds[0]||p.bounds[3]<=p.bounds[1]||p.bounds[2]-p.bounds[0]>=2||p.bounds[3]-p.bounds[1]>=2))return false;
  return a.warnings.some(w=>w.code===issue.code&&JSON.stringify(w.box)===JSON.stringify(issue.box));
}
export function recordNativeCrumbAcceptance(sheet,nest,receipt) {
  const e=sheet.scrapCuts,review=e?.nativeWasteReview;
  if(receipt?.approvedByHuman!==true||!receipt.humanAnswer||!receipt.sourceQuestionOrMessage||receipt.omitOnlyReviewedBoundaryPaths!==true||receipt.doesNotCoverLargerWaste!==true)throw Error('A specific human acceptance receipt is required.');
  if(!review?.fragments?.length||review.scope!==nativeWasteScope(sheet,nest)||!review.nativeEvidence?.sha256)throw Error('No unchanged measured native corner review is available.');
  const max=Number(receipt.maximumDimensionMm),area=Number(receipt.maximumAreaMm2);
  if(!(max>0&&max<2&&area>0&&area<=4)||review.fragments.some(p=>Math.max(p.bounds[2]-p.bounds[0],p.bounds[3]-p.bounds[1])>max+1e-8||p.areaMM2>area+1e-8))throw Error('Measured corner waste exceeds the specifically accepted limits.');
  const warnings=reviewScrapSheet(sheet,nest).issues.filter(p=>p.code==='native-crumb');
  e.nativeWasteAcceptance={version:1,action:'accept-native-corner-crumbs',decision:'accepted',acceptedAt:receipt.acceptedAt||new Date().toISOString(),
    receipt:{reference:receipt.sourceQuestionOrMessage,humanAnswer:receipt.humanAnswer,approvedByHuman:true,maximumDimensionMm:max,maximumAreaMm2:area},
    scope:nativeWasteScope(sheet,nest),nativeEvidence:structuredClone(review.nativeEvidence),fragments:structuredClone(review.fragments),warnings:warnings.map(p=>({code:p.code,box:p.box}))};
  return e.nativeWasteAcceptance;
}
export function editorPost(sheet,nest,settings=null) {
  settings ||= scrapSettingsFor(sheet,nest);
  const r=settings.bitDiameterMM/2;
  const parts=sheet.placements.map(p=>{const [a,c,b,d]=partBox(p);return modelNativePlacement(p,r,{id:p.name,box:[a,b,c,d]});});
  const contours=parts.map(p=>{const [a,b,c,d]=p.box;return p.contour||[[a-r,b-r,c+r,b-r],[c+r,b-r,c+r,d+r],[c+r,d+r,a-r,d+r],[a-r,d+r,a-r,b-r]]});
  return {parts,contours,radius:r,width:nest.sheetL,height:nest.sheetW,operations:sheet.scrapCuts?.operations||[],geometryWarnings:parts.flatMap(p=>p.geometryWarning?[p.geometryWarning]:[])};
}
// A named internal strip-clear stroke is permitted to be shorter than the
// cutter: its round end sweeps still remove real material. Never extend this
// to arbitrary crosscuts or a stroke whose cutter reaches the stock border.
function internalStripStroke(line,post){
  const same=(a,b)=>a?.length===4&&b?.length===4&&a.every((v,i)=>Math.abs(v-b[i])<.003);
  const op=post.operations?.find(p=>p.kind==='strip-pocket'&&(same(p.line,line)||same(p.line,[...line.slice(2),...line.slice(0,2)])));
  if(!op)return false;
  const r=post.radius,[x,y,a,b]=line;
  return Math.hypot(a-x,b-y)>.003&&Math.min(x,a)-r>.003&&Math.min(y,b)-r>.003&&Math.max(x,a)+r<post.width-.003&&Math.max(y,b)+r<post.height-.003;
}
export function cutProblems(lines,post,settings=SCRAP_DEFAULTS,{allowClearanceWarnings=false}={}) {
  const out=[],r=post.radius,clear=settings.clearanceMM;
  if(settings.maxPieceMM!==304.8||settings.minPieceMM!==50.8)return ['Scrap limits are 12 inches maximum X/Y and 2 inches minimum width.'];
  if(!(r>0)||!Number.isFinite(clear)||clear<3||clear>25||!Number.isFinite(settings.skinMM)||settings.skinMM<.2||settings.skinMM>2)return ['Skin must be 0.2-2 mm and part clearance 3-25 mm.'];
  if(!Array.isArray(lines))return ['Cut list is unreadable.'];
  for (const [i,s] of lines.entries()) {
    if(!Array.isArray(s)||s.length!==4||!s.every(Number.isFinite)){out.push(`Cut ${i+1}: invalid coordinates.`);continue;}
    const [x,y,a,b]=s;
    if(Math.abs(x-a)>.003&&Math.abs(y-b)>.003)out.push(`Cut ${i+1}: use a horizontal or vertical line.`);
    const internalStrip=internalStripStroke(s,post);
    if(Math.hypot(a-x,b-y)<2*r-.01&&!internalStrip)out.push(`Cut ${i+1}: shorter than the bit diameter; only an explicit internal strip-clear stroke may be shorter.`);
    if(Math.min(x,a)<-r-.01||Math.max(x,a)>post.width+r+.01||Math.min(y,b)<-r-.01||Math.max(y,b)>post.height+r+.01)out.push(`Cut ${i+1}: outside the sheet cutting envelope.`);
    const box=[Math.min(x,a)-r,Math.min(y,b)-r,Math.max(x,a)+r,Math.max(y,b)+r];
    for(const p of post.parts){const [u,v,c,d]=p.box;
      const distance=p.outline?segmentOutlineDistance(s,p.outline)-r:Math.max(u-box[2],box[0]-c,v-box[3],box[1]-d);
      if(distance<(allowClearanceWarnings ? 0 : internalStrip ? .25 : clear)-.003){out.push(allowClearanceWarnings?`Cut ${i+1}: cutter overlaps finished part ${p.id}.`:`Cut ${i+1}: too close to ${p.id}.`);break;}
    }
  }
  return out;
}
export function analyzeCuts(lines,post,settings=SCRAP_DEFAULTS,options={}) {
  const errors=cutProblems(lines,post,settings,options);
  if(errors.length)return {errors,pieces:[],oversize:[],slivers:[],cutLength:0,rapid:0};
  const raster=new Raster(post.width,post.height);
  for(const {box,outline} of post.parts)outline?raster.clearOutline(outline):raster.clear(...box);
  for(const line of post.contours.flat())raster.sweep(line,post.radius);
  for(const line of lines)raster.sweep(line,post.radius);
  // No morphological opening / ribbon exemption here. Narrow standing waste
  // remains visible; cutting it into many small pieces is not a passing result.
  const describe=k=>{
    const [a,b,c,d]=k.box;
    // The kerf has already been removed. Adding it again inflated dimensions
    // and contradicted the remaining-waste measurements in the native audit.
    const width=Math.min(post.width,c)-Math.max(0,a),height=Math.min(post.height,d)-Math.max(0,b);
    return {box:k.box,area:k.area,width,height,rasterToleranceMM:2,conservativeSkinAllowanceMM:2*post.radius,maxDimensionWithSkinAllowanceMM:Math.max(width,height)+2*post.radius};
  };
  const wholeIslands=raster.islands(),pieces=wholeIslands.map(describe);
  const oversize=pieces.filter(p=>Math.max(p.width,p.height)>settings.maxPieceMM);
  const opened=raster.opened(raster.material,settings.minPieceMM+1.2);
  const narrow=raster.material.map((v,i)=>v&&!opened[i]?1:0);
  // Measure narrow arms/corridors as well as wholly narrow islands. A broad
  // bounding box cannot conceal a one-inch tail attached to a large offcut.
  let slivers=raster.islands(narrow).filter(piece=>{
    const [a,b,c,d]=piece.box;
    // The 2 mm grid can leave one- or two-cell corner nibs at crossing kerfs.
    // They are attached to a larger waste island, not independent offcuts or
    // a continuous narrow corridor. Keep equally tiny ISOLATED chips flagged.
    if(piece.area>16||c-a>4||d-b>4)return true;
    const first=piece.cells.values().next().value;
    const parent=wholeIslands.find(island=>island.cells.has(first));
    return !parent||parent.area<=400;
  }).map(describe);
  const nativeGeometry=post.parts.every(p=>p.nativeOutline);
  if(nativeGeometry){
    // A morphological mesh fringe is not a measured narrow corridor. Check
    // real scan-line widths and prove a minimum-width square in each island.
    slivers=[...retainedNarrowCorridors(post,lines,settings.minPieceMM),...wholeIslands.filter(p=>p.area>16&&!hasWasteSquare(post,lines,p,settings.minPieceMM)).map(describe)];
  }
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
  if(!nativeGeometry)for(const p of post.parts){const [a,b,c,d]=p.box;
    tiny([0,b,a-D,d]);tiny([c+D,b,post.width,d]);
    tiny([a,0,c,b-D]);tiny([a,d+D,c,post.height]);
  }
  if(!nativeGeometry)for(let i=0;i<post.parts.length;i++)for(let j=i+1;j<post.parts.length;j++)for(const axis of [0,1]){
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
  if(!nativeGeometry)for(const [i,line] of lines.entries())if(createsNarrowStrip(line,post,settings,lines.filter((_,j)=>j!==i))){
    const box=[Math.min(line[0],line[2])-post.radius,Math.min(line[1],line[3])-post.radius,Math.max(line[0],line[2])+post.radius,Math.max(line[1],line[3])+post.radius];
    slivers.push({box,width:box[2]-box[0],height:box[3]-box[1],area:0,cutWarning:true,reason:`Cut ${i+1} can leave a narrow strip beside a part, sheet edge or other cut.`});
  }
  const resolution= nativeGeometry?wholeIslands.filter(p=>p.area<=16&&!hasWasteSquare(post,lines,p,settings.minPieceMM)&&!nativeTipConnected(post,lines,p,raster,wholeIslands)).map(describe):[];
  // Keep the preview's geometric measurements distinct from a conservative
  // skin-break envelope. The actual native-post audit verifies that envelope;
  // a raster estimate must not silently redefine the measured offcut width.
  const skinEnvelopeOversize=pieces.filter(p=>p.maxDimensionWithSkinAllowanceMM>settings.maxPieceMM);
  return {errors,pieces,oversize,slivers,resolution,skinEnvelopeOversize,cutLength:lines.reduce((n,s)=>n+Math.hypot(s[2]-s[0],s[3]-s[1]),0),rapid:rapidTravel(lines,[0,0])};
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
// The pocket planner can leave separate collinear segments across a clear
// waste corridor. Join them only when the added sweep clears every part,
// creates no new narrow waste, and does not make the modeled cycle slower.
export function consolidateSuggestedCuts(input,post,settings=SCRAP_DEFAULTS,isSafe=()=>true) {
  let lines=input.map(l=>[...l]);
  const time=ls=>estimateRouteTime(cutRoutes(ls),{skin:settings.skinMM,finish:[0,post.height/2]});
  for(let joined=0,attempts=0;joined<16&&attempts<80;){
    const pairs=[];
    for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
      const a=lines[i],b=lines[j],va=Math.abs(a[0]-a[2])<.003,vb=Math.abs(b[0]-b[2])<.003;
      if(va!==vb)continue;
      const f=va?0:1,t=1-f;if(Math.abs(a[f]-b[f])>.1)continue;
      const alo=Math.min(a[t],a[t+2]),ahi=Math.max(a[t],a[t+2]);
      const blo=Math.min(b[t],b[t+2]),bhi=Math.max(b[t],b[t+2]);
      const gap=Math.max(alo,blo)-Math.min(ahi,bhi);
      if(gap<0||gap>500)continue;
      const lo=Math.min(alo,blo),hi=Math.max(ahi,bhi),fixed=a[f];
      pairs.push({i,j,gap,line:va?[fixed,lo,fixed,hi]:[lo,fixed,hi,fixed]});
    }
    pairs.sort((a,b)=>a.gap-b.gap);
    let changed=false;const oldTime=time(lines);
    for(const p of pairs){if(++attempts>80)break;
      if(cutProblems([p.line],post,settings).length)continue;
      const candidate=lines.filter((_,i)=>i!==p.i&&i!==p.j).concat([p.line]);
      if(time(candidate)>oldTime+.05||!isSafe(candidate))continue;
      lines=candidate;joined++;changed=true;break;
    }
    if(!changed)break;
  }
  return lines;
}
// Explicit operator action for a long, already-narrow waste band. It divides
// length for conveyor handling; it does NOT cure the under-2-inch width, so
// the warning and export override remain mandatory.
export function divideNarrowWaste(box,post,settings=SCRAP_DEFAULTS,existing=[]) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite))throw Error('Select a narrow waste region first.');
  const [a,b,c,d]=box,horizontal=c-a>=d-b,along=horizontal?c-a:d-b;
  if(along<=settings.maxPieceMM)throw Error('This narrow waste is already under 12 inches long.');
  const across=horizontal?d-b:c-a;
  if(across>=settings.minPieceMM)throw Error('This is not a narrow waste strip.');
  const major=horizontal?0:1,minor=1-major,pad=post.radius+settings.clearanceMM;
  const lo=box[major],hi=box[major+2],mid=(box[minor]+box[minor+2])/2;
  // Allow two raster cells of measurement tolerance at both ends; otherwise
  // the last section can read a few millimetres over 12 inches.
  // End sections keep half a kerf less than the interior sections. Reserve
  // that endpoint fringe (plus two preview cells) in each equal pitch; adding
  // one diameter to the whole band underestimates the required divisions.
  const pitchLimit=settings.maxPieceMM-post.radius-4;
  const n=Math.ceil(along/pitchLimit),added=[];
  for(let i=1;i<n;i++){
    const fixed=rounded(lo+(hi-lo)*i/n);
    let from=Math.max(-post.radius,box[minor]-post.radius);
    let to=Math.min((minor?post.height:post.width)+post.radius,box[minor+2]+post.radius);
    for(const {box:p} of post.parts){
      if(fixed<p[major]-pad||fixed>p[major+2]+pad)continue;
      if(p[minor+2]<=mid)from=Math.max(from,p[minor+2]+pad);
      else if(p[minor]>=mid)to=Math.min(to,p[minor]-pad);
      else {from=to;break;}
    }
    const line=horizontal?[fixed,from,fixed,to]:[from,fixed,to,fixed];
    if(to-from<2*post.radius||cutProblems([line],post,settings).length)continue;
    if(existing.some(s=>Math.abs(s[major]-s[major+2])<.003&&
      Math.abs(s[major]-fixed)<2*post.radius&&
      Math.min(Math.max(s[minor],s[minor+2]),to)>Math.max(Math.min(s[minor],s[minor+2]),from)))continue;
    added.push(line.map(rounded));
  }
  if(!added.length)throw Error('No clear crosscuts fit this strip. Move parts or revise the nest.');
  return added;
}
export function suggestCuts(sheet,nest,settings=null) {
  settings ||= scrapSettingsFor(null,nest);
  const post=editorPost(sheet,nest,settings);
  const repair=improveSuggestion([],post,settings);
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
  for(const edge of post.contours.flat()){
    if(Math.abs(edge[axis]-edge[axis+2])>.003)continue;
    if(Math.min(hi,Math.max(edge[t],edge[t+2]))-Math.max(lo,Math.min(edge[t],edge[t+2]))<D)continue;
    if(narrow(Math.abs(fixed-edge[axis])-D))return true;
  }
  for(const s of other){
    if((Math.abs(s[0]-s[2])<.003?0:1)!==axis)continue;
    if(Math.min(hi,Math.max(s[t],s[t+2]))-Math.max(lo,Math.min(s[t],s[t+2]))>=D&&narrow(Math.abs(s[axis]-fixed)-D))return true;
  }
  return false;
}
function wasteGrid(lines,post){
  const raster=new Raster(post.width,post.height);
  for(const {box,outline} of post.parts)outline?raster.clearOutline(outline):raster.clear(...box);
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
export function improveSuggestion(seed,post,settings=SCRAP_DEFAULTS,focusBox=null){
  const baseline=narrowMask(seed,post,settings);
  const repair=planAlignedWaste(post,settings,{seed,focusBox,
    valid:l=>!cutProblems([l],post,settings).length,
    safe:ls=>!introducedNarrowCells(baseline,narrowMask(ls,post,settings)),
    unsafe:(l,other)=>createsNarrowStrip(l,post,settings,other)});
  // Grid spans already end at their intended boundary. Do not extend a tip
  // toward an unrelated crossing after the width check has passed.
  const lines=normalizeCuts(repair.lines),report=analyzeCuts(lines,post,settings);
  return {lines,summary:{method:repair.method,divisionStrategy:'minimum-even-divisions',maximumPieceInches:12,conservativeSkinAllowanceMM:2*post.radius,regions:repair.regions,
    oversize:report.oversize.length,slivers:report.slivers.length,layoutIssues:layoutWasteIssues(post,settings),
    skinEnvelopeOversize:report.skinEnvelopeOversize?.length||0,needsLayoutChanges:report.slivers.length>0,complete:!report.errors.length&&!report.oversize.length&&!report.skinEnvelopeOversize?.length&&!report.slivers.length}};
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
  if(!edit.routes)return phase==='after-outlines'?cutRoutes(normalizeCuts(edit.lines)):straightCutRoutes(normalizeCuts(edit.lines),{finish:[0,post?.height/2||0]});
  if(!Array.isArray(edit.routes)||edit.routes.some(p=>!Array.isArray(p)||p.length<2||p.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite))))throw Error('Cut order is unreadable. Use Auto order again.');
  if(phase==='before-outlines'&&edit.routes.some(p=>p.length!==2||Math.abs(p[0][0]-p[1][0])>.003&&Math.abs(p[0][1]-p[1][1])>.003))throw Error('Before outlines uses one straight cut per path. Use Auto order to remove old connected paths.');
  if(geometryKey(routeLines(edit.routes))!==geometryKey(edit.lines))throw Error('Cut order no longer matches the cuts. Use Auto order again.');
  return structuredClone(edit.routes);
}
// One review powers the nest-page list and export. Advisory warnings may be
// explicitly accepted; cutter/part collisions and unreadable paths remain errors.
export function reviewScrapSheet(sheet,nest,index=0) {
  const edit=sheet.scrapCuts,issues=[],number=index+1;
  const add=(severity,code,message,extra={})=>issues.push({sheet:number,severity,code,message,...extra});
  if(!edit){
    add(sheet.scrapCutsPendingActualNativePost?'warning':'error','missing-plan',sheet.scrapCutsPendingActualNativePost?'Scrap plan pending a fresh native post. No added scrap cuts are saved for this draft.':'No scrap plan saved. Suggest cuts or add cuts for this sheet.');
    const settings=scrapSettingsFor(sheet,nest),post=editorPost(sheet,nest,settings),report=analyzeCuts([],post,settings,{allowClearanceWarnings:true});
    for(const warning of post.geometryWarnings)add('warning','unverified-outline',warning);
    for(const p of report.oversize)add('warning','oversize',`Connected uncut waste spans ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches (bounding extent; parts excluded), ${(p.area/25.4**2).toFixed(1)} square inches. It still needs breakup to meet the 12-inch limit.`,{box:p.box});
    for(const p of report.slivers)add('warning','narrow',`Uncut scrap ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches contains waste under 2 inches wide. Move nearby parts.`,{box:p.box});
    return {issues,report};
  }
  const settings=scrapSettingsFor(sheet,nest),post=editorPost(sheet,nest,settings);
  if(edit.settings?.bitDiameterMM!==undefined&&Math.abs(Number(edit.settings.bitDiameterMM)-settings.bitDiameterMM)>.001)add('error','cutter-mismatch','Saved scrap cuts use a different cutter diameter than this nest. Recheck the actual cutter and recreate/review those cuts before export.');
  for(const warning of post.geometryWarnings)add('warning','unverified-outline',warning);
  if(edit.layout!==layoutStamp(sheet,nest))add('warning','stale','Parts changed after the last review. Recheck this sheet.');
  const hard=cutProblems(edit.lines,post,settings,{allowClearanceWarnings:true});
  const locate=message=>{const m=message.match(/^Cut (\d+)\b/),cut=m?Number(m[1])-1:null,l=edit.lines?.[cut];return cut===null?{}:{cut,box:Array.isArray(l)&&l.every(Number.isFinite)?[Math.min(l[0],l[2]),Math.min(l[1],l[3]),Math.max(l[0],l[2]),Math.max(l[1],l[3])]:null};};
  for(const message of hard)add('error','geometry',message,locate(message));
  if(!hard.length)for(const message of cutProblems(edit.lines,post,settings))add('warning','clearance',message+' Preferred clearance is '+settings.clearanceMM+' mm; cutter does not overlap the part.',locate(message));
  const report=analyzeCuts(edit.lines,post,settings,{allowClearanceWarnings:true});
  const nativeReview=edit.nativeWasteReview,measured=nativeReview?.version===1&&nativeReview.scope===nativeWasteScope(sheet,nest)&&nativeReview.nativeEvidence?.sha256&&Array.isArray(nativeReview.fragments)?nativeReview.fragments:[];
  if(nativeReview&&nativeReview.scope!==nativeWasteScope(sheet,nest))add('warning','native-review-stale','The reviewed native waste changed. Recheck its measured exceptions.');
  const intersects=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
  for(const p of report.resolution||[])if(!measured.some(f=>intersects(f.bounds,p.box)))add('warning','resolution','A tiny region is below the 2 mm preview resolution. Verify the native post; this is not a measured under-2-inch scrap.',{box:p.box});
  for(const p of measured){
    const[a,b,c,d]=p.bounds||[];
    if(![a,b,c,d,p.areaMM2].every(Number.isFinite)||c<=a||d<=b||p.areaMM2<=0){add('warning','native-review-invalid','The measured native waste record is invalid.');continue;}
    add('warning','native-crumb',`Measured native corner crumb ${(c-a).toFixed(3)} × ${(d-b).toFixed(3)} mm; ${p.areaMM2.toFixed(3)} mm². Review the specific exception.`,{box:p.bounds,areaMM2:p.areaMM2});
  }
  for(const [code,pieces,rule] of [['oversize',report.oversize,'over 12 inches in X or Y'],['narrow',report.slivers,'under 2 inches wide']])
    for(const p of pieces)add('warning',code,(p.reason||(code==='narrow'&&Math.min(p.width,p.height)>=settings.minPieceMM?`Scrap region ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches contains a narrow corridor under 2 inches.`:`Scrap ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches: ${rule}.`)),{...locate(p.reason||''),box:p.box});
  if(!hard.length)try{plannedRoutes(edit,post);}catch(e){add('error','routes',e.message);}
  for(const issue of issues)if(acceptedNativeCrumb(issue,sheet,nest)){
    issue.accepted=true;issue.acceptance='Reviewed native corner crumb; acceptance is scoped to this unchanged geometry and cut plan.';issue.message+=' Accepted for this unchanged native geometry and cut plan.';
  }
  return {issues,report};
}
export function scrapPlanStamp(plan){return JSON.stringify([plan.sheet,plan.frame,plan.width,plan.height,plan.parts,plan.settings,plan.phase,plan.finishTarget,plan.orderMode,plan.lines,plan.routes]);}
export function hasWarningOverride(plan){return plan.warningOverride?.version===1&&plan.warningOverride?.action==='export-with-warnings'&&plan.warningOverride?.stamp===scrapPlanStamp(plan);}
export function exportCutPlans(nest,{overrideWarnings=false}={}) {
  return nest.sheets.flatMap((sheet,i)=>{
    const edit=sheet.scrapCuts;if(!edit)return [];
    const {issues}=reviewScrapSheet(sheet,nest,i),errors=issues.filter(x=>x.severity==='error'),warnings=issues.filter(x=>x.severity==='warning'&&!x.accepted);
    if(errors.length)throw Error(`Sheet ${i+1}: ${errors[0].message}`);
    if(warnings.length&&!overrideWarnings){
      if(warnings[0].code==='stale')throw Error(`Sheet ${i+1}: parts changed after its scrap cuts were checked. Open Scrap cuts and recheck them.`);
      throw Error(`Sheet ${i+1}: ${warnings[0].message} Review or override warnings when exporting.`);
    }
    const settings=scrapSettingsFor(sheet,nest),post=editorPost(sheet,nest,settings);
    const routes=plannedRoutes(edit,post),phase=checkScrapPhase(edit);
    const plan={sheet:i+1,frame:'nest-xy',width:post.width,height:post.height,parts:post.parts,settings,phase,finishTarget:'left-middle',orderMode:edit.routes?'manual':'automatic',lines:normalizeCuts(edit.lines),routes};
    if(issues.some(x=>x.accepted))plan.nativeWasteAcceptance=structuredClone(edit.nativeWasteAcceptance);
    if(overrideWarnings&&warnings.length)plan.warningOverride={version:1,action:'export-with-warnings',acceptedAt:new Date().toISOString(),warnings,stamp:scrapPlanStamp(plan)};
    return [plan];
  });
}
