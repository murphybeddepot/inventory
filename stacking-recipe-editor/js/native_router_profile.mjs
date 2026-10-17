// A deliberately bounded production profile, verified against installed native
// half-inch jobs. An absent profile preserves legacy generic export behavior.
export const HALF12_STANDARD_PROFILE=Object.freeze({
  version:1,id:'MBD-HALF12-STANDARD',machine:'NewCNC-MD',toolset:'J010-BN-T2',machineTemplateId:8,
  mainTool:2,diameterMM:12.7,smallPartHandling:Object.freeze({strategy:'standard',shortSideIn:7.75,areaIn2:340})
});
export function verifiedNativeRouterProfile(nest,machine='NewCNC-MD'){
  const p=nest?.nativeRouterProfile;if(p===undefined||p===null)return null;
  const t=HALF12_STANDARD_PROFILE,h=p.smallPartHandling;
  if(p.version!==t.version||p.id!==t.id||p.machine!==t.machine||machine!==t.machine||p.toolset!==t.toolset||p.machineTemplateId!==t.machineTemplateId||p.mainTool!==t.mainTool||p.diameterMM!==t.diameterMM||h?.strategy!==t.smallPartHandling.strategy||h.shortSideIn!==t.smallPartHandling.shortSideIn||h.areaIn2!==t.smallPartHandling.areaIn2)
    throw Error('Unsupported native router profile. Use the verified T2 half-inch / standard-holding profile, or preserve the legacy export without an explicit profile.');
  if(nest.toolDiameterMM!==undefined&&Number(nest.toolDiameterMM)!==t.diameterMM)throw Error('Saved nest cutter diameter conflicts with its verified native router profile.');
  return structuredClone(t);
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
