// Shop rules proven on J054..J060 Boaz jobs, saved in PREPARED-v2026.09.18.1.json.
// Millimetres from the physical sheet edge; y increases UP in the editor.
export const SHOP_VACUUM_PROFILE = '2026.09.18.1';
export const isSmallish = p => Math.min(p.l,p.w)<220 || p.l*p.w<140000;
// Preferred auto-placement inset only. The operator permits manual placements
// at the valid cutting boundary; 60/132mm are not save/export requirements.
export const vacuumInset = p => Math.min(p.l,p.w)<120 ? 132 : isSmallish(p) ? 60 : 0;
export const largePanelArea = o => o.vacuumProfile===SHOP_VACUUM_PROFILE
  ? {x:o.sheetL/2,y:0,w:o.sheetL/2,h:o.sheetW/2} : null;
export function vacuumViolations(ps,o) {
  if(o.vacuumProfile!==SHOP_VACUUM_PROFILE)return [];
  const reserved=largePanelArea(o);
  const out=[];
  for(const p of ps){
    if(p.salvage||p.remnant)continue;
    const turn=Number(p.rotation||0)%180!==0,w=turn?p.w:p.l,h=turn?p.l:p.w;
    const x=Math.min(p.x,o.sheetL-p.x-w),y=Math.min(p.y,o.sheetW-p.y-h),inset=vacuumInset(p);
    const reason=isSmallish(p)&&p.x+w>reserved.x+.01&&p.y<reserved.y+reserved.h-.01 ? 'bottom-right quarter is reserved for large panels' : null;
    if(reason)out.push({a:p.name,b:'vacuum zone',reason,mm:Math.min(x,y),gap:inset,overlap:false});
  }
  return out;
}
