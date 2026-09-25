// Shop rules proven on J054..J060 Boaz jobs, saved in PREPARED-v2026.09.18.1.json.
// Millimetres from the physical sheet edge; y increases UP in the editor.
export const SHOP_VACUUM_PROFILE = '2026.09.18.1';
export const isSmallish = p => Math.min(p.l,p.w)<220 || p.l*p.w<140000;
// Preferred auto-placement inset only. The operator permits manual placements
// at the valid cutting boundary; 60/132mm are not save/export requirements.
export const vacuumInset = p => Math.min(p.l,p.w)<120 ? 132 : isSmallish(p) ? 60 : 0;
export function vacuumViolations(ps,o) {
  if(o.vacuumProfile!==SHOP_VACUUM_PROFILE)return [];
  const out=[];
  for(const p of ps){
    if(p.salvage||p.remnant)continue;
    const turn=Number(p.rotation||0)%180!==0,w=turn?p.w:p.l,h=turn?p.l:p.w;
    const x=Math.min(p.x,o.sheetL-p.x-w),y=Math.min(p.y,o.sheetW-p.y-h),inset=vacuumInset(p);
    const reason=Math.min(p.l,p.w)<120&&x<300-.01&&y<300-.01 ? 'skinny part is inside a 300mm corner zone'
      : isSmallish(p)&&p.x+w>o.sheetL/2+.01&&p.y<o.sheetW/2-.01 ? 'bottom-right quarter is reserved for large panels' : null;
    if(reason)out.push({a:p.name,b:'vacuum zone',reason,mm:Math.min(x,y),gap:inset,overlap:false});
  }
  return out;
}
