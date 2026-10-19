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
export function verifiedNativeRouterProfile(nest,machine='NewCNC-MD'){
  const p=nest?.nativeRouterProfile;if(p===undefined||p===null)return null;
  const t=p.id===HALF12_BED_DRILL_ONLY_PROFILE.id?HALF12_BED_DRILL_ONLY_PROFILE:HALF12_STANDARD_PROFILE,h=p.smallPartHandling;
  if(p.version!==t.version||p.id!==t.id||p.machine!==t.machine||machine!==t.machine||p.toolset!==t.toolset||p.machineTemplateId!==t.machineTemplateId||p.mainTool!==t.mainTool||p.diameterMM!==t.diameterMM||h?.strategy!==t.smallPartHandling.strategy||h.shortSideIn!==t.smallPartHandling.shortSideIn||h.areaIn2!==t.smallPartHandling.areaIn2)
    throw Error('Unsupported native router profile. Use the verified T2 half-inch / standard-holding profile, or preserve the legacy export without an explicit profile.');
  if(t===HALF12_BED_DRILL_ONLY_PROFILE &&
      (p.scope?.job!==t.scope.job||p.scope?.bedOnly!==true||nest.sku!==t.scope.job))
    throw Error('The template4 bed/drill profile is scoped only to 33619-KSOFAW with no optional crate fills.');
  if(nest.toolDiameterMM!==undefined&&Number(nest.toolDiameterMM)!==t.diameterMM)throw Error('Saved nest cutter diameter conflicts with its verified native router profile.');
  return structuredClone(t);
}

// Called after native source records have been parsed and before an OPT is
// emitted. A drawing/profile flag alone cannot establish the bed-only scope.
export function assertNativeRouterSourceScope(profile,nest,parts,jobName){
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
