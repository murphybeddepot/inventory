import {fitSalvage} from './scrap.mjs?v=4.49';
import {grainRotations,nestViolations} from './nest.mjs?v=4.49';
import {SCRAP_DEFAULTS,editorPost,narrowMask,introducedNarrowCells,analyzeCuts,suggestCuts} from './scrap_editor.mjs?v=4.49';

export function suggestSheet({sheet,nest,settings=SCRAP_DEFAULTS,mode='cuts',crate={}}){
  const target=structuredClone(sheet);let added=[];
  if(mode==='crates'||mode==='both'){
    const opts={...nest,...crate.opts,sheetL:nest.sheetL,sheetW:nest.sheetW};
    const before=editorPost(target,nest,settings),baseline=narrowMask([],before,settings);
    const baselineTiny=new Set(analyzeCuts([],before,settings).slivers.filter(p=>p.subGrid).map(p=>JSON.stringify(p.box)));
    const initialViolations=new Set(nestViolations({...opts,sheets:[target]}).map(v=>JSON.stringify(v)));
    opts.acceptCandidate=(candidate,placed)=>{
      if(opts.hasGrain&&!grainRotations({name:candidate.name,w:candidate.l,h:candidate.w},opts.crossGrain||new Set()).includes(candidate.rotation))return false;
      const proposal={placements:[...placed,candidate]};
      if(nestViolations({...opts,sheets:[proposal]}).some(v=>!initialViolations.has(JSON.stringify(v))))return false;
      const post=editorPost(proposal,nest,settings);
      if(introducedNarrowCells(baseline,narrowMask([],post,settings)))return false;
      return !analyzeCuts([],post,settings).slivers.some(p=>p.subGrid&&!baselineTiny.has(JSON.stringify(p.box)));
    };
    added=fitSalvage(target,opts,(crate.catalog||[]).filter(c=>c.src),crate.budget||{});
    target.placements.push(...added);
  }
  const plan=mode==='crates'?null:suggestCuts(target,nest,settings);
  return {plan,placements:target.placements,summary:{mode,added:added.map(p=>p.name),yieldPercent:target.placements.reduce((n,p)=>n+p.l*p.w,0)/(nest.sheetL*nest.sheetW)*100}};
}
