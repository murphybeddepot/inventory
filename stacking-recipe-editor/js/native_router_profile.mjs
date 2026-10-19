import {nativeSnapshotScope,nativeXmlFingerprint,sha256Text,rejectNativeXmlComments,nativePackingSourcesFingerprint} from './native_source_scope.mjs?v=4.67';
import {VERIFIED_LIBRARY_SOURCES} from './verified_library_sources.mjs?v=4.67';
// A deliberately bounded production profile, verified against installed native
// half-inch jobs. An absent profile preserves legacy generic export behavior.
export const HALF12_STANDARD_PROFILE=Object.freeze({
  version:1,id:'MBD-HALF12-STANDARD',machine:'NewCNC-MD',toolset:'J010-BN-T2',machineTemplateId:8,
  mainTool:2,diameterMM:12.7,smallPartHandling:Object.freeze({strategy:'standard',shortSideIn:7.75,areaIn2:340})
});
// Separate, deliberately job-bound bed-only ownership profile. This does not
// certify machine execution: a fresh native post must prove VCNC drilling and
// zero unintended router head/plunge commands before a production release.
export const HALF12_BED_DRILL_ONLY_PROFILE=Object.freeze({
  version:1,id:'MBD-HALF12-BED-DRILL-ONLY',machine:'NewCNC-MD',toolset:'J010-BN-T2',machineTemplateId:4,
  mainTool:2,diameterMM:12.7,smallPartHandling:Object.freeze({strategy:'standard',shortSideIn:7.75,areaIn2:340}),
  scope:Object.freeze({job:'33619-KSOFAW',bedOnly:true})
});
// Native 33619 construction identities, including four identical front panels.
// This initial scope deliberately excludes optional crate/remnant additions.
const BED_DRILL_ONLY_PARTS=Object.freeze([
  ['1A',2286,378],['1B',2286,378],['4A',2286,378],['5A',2286,378],
  ['2B',2032,378],['6A',2029,82],['4B',2286,152],['5B',2286,152],
  ['2D',2032,150],['2A',2032,358],['4C',2286,146],['5C',2286,146],
  ['3A',2108,504],['3A',2108,504],['3A',2108,504],['3A',2108,504],
  ['2E',2032,74],['2C',2032,77]
]);
export const VERIFIED_LIBRARY_PROFILE_ID='MBD-HALF12-VERIFIED-LIBRARY';
export function verifiedLibraryRouterProfile(job){
  if(!Object.hasOwn(VERIFIED_LIBRARY_SOURCES,job))throw Error('No reviewed template4 Library source scope exists for this job.');
  return {...structuredClone(HALF12_BED_DRILL_ONLY_PROFILE),id:VERIFIED_LIBRARY_PROFILE_ID,scope:{job,bedOnly:true,sourceVersion:1}};
}
function assertPackingSourceScope(expected,nest){
  if(expected.packingOnlyPurchasedSourcesSha256!==undefined||nest.packingOnlyPurchasedSources!==undefined)
    if(nativePackingSourcesFingerprint(nest)!==expected.packingOnlyPurchasedSourcesSha256)
      throw Error('Reviewed bought packing source scope changed or is missing. Preserve the separate purchased-door drilling source.');
}
export function assertNativeRouterSnapshotScope(snapshot,nest,jobName){
  const p=verifiedNativeRouterProfile(nest);
  if([VERIFIED_LIBRARY_PROFILE_ID,HALF12_BED_DRILL_ONLY_PROFILE.id].includes(p?.id))
    for(const text of [snapshot.sourceShell,...Object.values(snapshot.sourceShells||{}),...(snapshot.importedParts||[]).map(p=>p.raw)])if(text!==undefined)rejectNativeXmlComments(text);
  if(p?.id!==VERIFIED_LIBRARY_PROFILE_ID)return;
  const job=p.scope.job,expected=VERIFIED_LIBRARY_SOURCES[job];
  if(snapshot.sku!==job||jobName!==job)throw Error('Reviewed Library source scope cannot be cloned to another job.');
  const actual=nativeSnapshotScope(snapshot);
  for(const [field,value] of Object.entries(expected.scope))if(actual[field]!==value)
    throw Error('Reviewed Library source scope changed: '+field+'. Re-verify native sources/frames before using this profile.');
  assertPackingSourceScope(expected,nest);
  const ids=(snapshot.importedParts||[]).map(p=>Number(p._nativePartNumber)),placed=(nest.sheets||[]).flatMap(sh=>sh.placements||[]).map(p=>Number(p.nativePartNumber));
  if(ids.some(n=>!Number.isInteger(n)||n<=0)||placed.some(n=>!Number.isInteger(n)||n<=0)||new Set(placed).size!==placed.length||JSON.stringify(ids.slice().sort((a,b)=>a-b))!==JSON.stringify(placed.slice().sort((a,b)=>a-b)))throw Error('Reviewed Library source identity inventory changed or is missing.');
  const material=nest.material||{};
  for(const [field,value] of Object.entries(expected.material))if(String(material[field])!==String(value))
    throw Error('Reviewed Library source material changed: '+field+'.');
}
export function verifiedNativeRouterProfile(nest,machine='NewCNC-MD'){
  const p=nest?.nativeRouterProfile;if(p===undefined||p===null)return null;
  const t=p.id===VERIFIED_LIBRARY_PROFILE_ID?verifiedLibraryRouterProfile(p.scope?.job):p.id===HALF12_BED_DRILL_ONLY_PROFILE.id?HALF12_BED_DRILL_ONLY_PROFILE:HALF12_STANDARD_PROFILE,h=p.smallPartHandling;
  if(p.version!==t.version||p.id!==t.id||p.machine!==t.machine||machine!==t.machine||p.toolset!==t.toolset||p.machineTemplateId!==t.machineTemplateId||p.mainTool!==t.mainTool||p.diameterMM!==t.diameterMM||h?.strategy!==t.smallPartHandling.strategy||h.shortSideIn!==t.smallPartHandling.shortSideIn||h.areaIn2!==t.smallPartHandling.areaIn2)
    throw Error('Unsupported native router profile. Use the verified T2 half-inch / standard-holding profile, or preserve the legacy export without an explicit profile.');
  if(t===HALF12_BED_DRILL_ONLY_PROFILE &&
      (p.scope?.job!==t.scope.job||p.scope?.bedOnly!==true||nest.sku!==t.scope.job))
    throw Error('The template4 bed/drill profile is scoped only to 33619-KSOFAW with no optional crate fills.');
  if(t.id===VERIFIED_LIBRARY_PROFILE_ID && (p.scope?.job!==t.scope.job||p.scope?.bedOnly!==true||p.scope?.sourceVersion!==1||nest.sku!==t.scope.job))throw Error('Reviewed Library source profile is job-bound and bed-only.');
  if(nest.toolDiameterMM!==undefined&&Number(nest.toolDiameterMM)!==t.diameterMM)throw Error('Saved nest cutter diameter conflicts with its verified native router profile.');
  return structuredClone(t);
}

// Called after native source records have been parsed and before an OPT is
// emitted. A drawing/profile flag alone cannot establish the bed-only scope.
export function assertNativeRouterSourceScope(profile,nest,parts,jobName){
  if([VERIFIED_LIBRARY_PROFILE_ID,HALF12_BED_DRILL_ONLY_PROFILE.id].includes(profile?.id))
    for(const p of parts)if(p.raw!==undefined)rejectNativeXmlComments(p.raw);
  if(profile?.id===VERIFIED_LIBRARY_PROFILE_ID){
    const expected=VERIFIED_LIBRARY_SOURCES[profile.scope.job],placements=(nest.sheets||[]).flatMap(s=>s.placements||[]);
    assertPackingSourceScope(expected,nest);
    if(jobName!==profile.scope.job||nest.sku!==profile.scope.job)throw Error('Reviewed Library source scope cannot be cloned to another job.');
    if(parts.some(p=>p.salvage)||placements.some(p=>p.salvage||p.remnant||p.src))throw Error('Reviewed Library source profile excludes optional crate/remnant parts.');
    if(parts.length!==expected.parts||placements.length!==expected.parts||parts.some(p=>!p.raw))throw Error('Reviewed Library profile requires every exact native source part.');
    const sourceIDs=parts.map(p=>Number(p.sourceNativePartNumber)),placedIDs=placements.map(p=>Number(p.nativePartNumber));
    if(sourceIDs.some(n=>!Number.isInteger(n)||n<=0)||placedIDs.some(n=>!Number.isInteger(n)||n<=0)||new Set(placedIDs).size!==placedIDs.length||JSON.stringify(sourceIDs.slice().sort((a,b)=>a-b))!==JSON.stringify(placedIDs.slice().sort((a,b)=>a-b)))throw Error('Reviewed Library emitted source identity inventory changed or is missing.');
    if(sha256Text(JSON.stringify(parts.map(p=>[Number(p.sourceNativePartNumber),nativeXmlFingerprint(p.raw)]).sort((a,b)=>a[0]-b[0])))!==expected.scope.nativeSourceIdsSha256)throw Error('Reviewed Library emitted physical source identity changed.');
    if(sha256Text(JSON.stringify(parts.map(p=>nativeXmlFingerprint(p.raw)).sort()))!==expected.scope.rawPartsSha256)throw Error('Reviewed Library emitted physical source changed.');
    const key=p=>JSON.stringify([p.name,+p.l,+p.w,+(p.sourceLayer??p.layer)]);
    if(JSON.stringify(parts.map(key).sort())!==JSON.stringify(placements.map(key).sort()))throw Error('Reviewed Library source part/layer placement inventory changed.');
    return;
  }
  if(profile?.id!==HALF12_BED_DRILL_ONLY_PROFILE.id)return;
  const expectedJob=HALF12_BED_DRILL_ONLY_PROFILE.scope.job;
  const placements=(nest.sheets||[]).flatMap(s=>s.placements||[]);
  if(jobName!==expectedJob||nest.sku!==expectedJob)
    throw Error('The template4 bed/drill source scope cannot be cloned to another job.');
  if(parts.some(p=>p.salvage)||placements.some(p=>p.salvage||p.remnant||p.src))
    throw Error('The template4 bed/drill source scope excludes optional crate or remnant parts.');
  const key=p=>JSON.stringify([p.name,Number(p.l),Number(p.w)]);
  const expected=BED_DRILL_ONLY_PARTS.map(p=>JSON.stringify(p)).sort();
  const same=rows=>JSON.stringify(rows.map(key).sort())===JSON.stringify(expected);
  if(!same(parts)||!same(placements))
    throw Error('The template4 bed/drill source scope requires the exact 18 native 33619 bed parts and dimensions, with no optional fills.');
}

// Saved geometry is not recomputed when this display/planning setting is read.
// The explicit verified machine profile wins; legacy nests retain their saved
// diameter or the existing 3/8-inch fallback when no diameter was recorded.
export function nestCutterDiameterMM(nest){
  if(nest?.nativeRouterProfile)return verifiedNativeRouterProfile(nest).diameterMM;
  for(const value of [nest?.toolDiameterMM,nest?.bitDiameterMM,nest?.toolDiameter]){
    const n=Number(value);if(Number.isFinite(n)&&n>0)return n;
  }
  return null;
}
