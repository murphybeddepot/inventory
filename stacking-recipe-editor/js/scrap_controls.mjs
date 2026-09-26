import {SCRAP_DEFAULTS,layoutStamp,editorPost,cutProblems,analyzeCuts,normalizeCuts,plannedRoutes} from './scrap_editor.mjs?v=4.42';
import {checkScrapPhase,estimateRouteTime} from './scrap_after.mjs?v=4.42';
import {suggestSheet} from './scrap_suggestions.mjs?v=4.42';
import {cutRoutes,routeLines} from './scrap_routes.mjs?v=4.42';
import {distributeSelection,spacingPreview} from './nest_spacing.mjs?v=4.42';

// The editor owns intent; native posting rechecks against the actual tool and
// part contours. Capture-phase handlers keep scrap gestures out of part moves.
export function installScrapControls({document,window,getNest,getSheet,getSelection,selectParts,changed,draw,getCrateOptions=()=>({})}) {
  const $=id=>document.getElementById(id),svg=$('board');
  let active=false,drawing=false,selected=-1,gesture=null,lastSheet=null,cache=null;
  let suggestion=null,routeIndex=0,lastOrderKey='',routeCache=null;
  function routesFor(ed){const post=editorPost(getSheet(),getNest(),settings()),key=JSON.stringify([ed,post]);if(routeCache?.key===key)return routeCache.routes;const routes=plannedRoutes(ed,post);routeCache={key,routes};return routes;}
  const history=[];
  const settings=()=>({...SCRAP_DEFAULTS,phase:'after-outlines',...getSheet()?.scrapCuts?.settings});
  const message=(s,bad=false)=>{const el=$('cutMessage');el.textContent=s;el.style.color=bad?'var(--bad)':'var(--soft)';};
  function ensure(){const s=getSheet();return s.scrapCuts ||= {version:1,settings:settings(),layout:layoutStamp(s,getNest()),lines:[]};}
  const serial=()=>JSON.stringify(getNest().sheets);
  function record(before){history.push({before,after:serial()});if(history.length>30)history.shift();cache=null;changed();draw();}
  function action(fn){try{fn();}catch(e){message(e.message,true);}}
  function point(e){const p=new window.DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());return [Math.round((p.x-20)*10)/10,Math.round((getNest().sheetW-p.y+20)*10)/10];}
  const snapped=(a,b)=>Math.abs(a[0]-b[0])>=Math.abs(a[1]-b[1])?[b[0],a[1]]:[a[0],b[1]];
  function report(){const s=getSheet(),n=getNest(),ed=s?.scrapCuts;if(!ed)return null;
    const key=JSON.stringify([layoutStamp(s,n),ed]);if(cache?.key===key)return cache.value;
    const value=analyzeCuts(ed.lines,editorPost(s,n,settings()),settings());cache={key,value};return value;
  }
  function remove(){if(selected<0)return;const before=serial();ensure().lines.splice(selected,1);delete ensure().routes;selected=-1;record(before);}
  function finish(cancel=false){if(!gesture)return;const g=gesture;gesture=null;
    if(svg.hasPointerCapture(g.pointerId))svg.releasePointerCapture(g.pointerId);
    // Permit one-at-a-time repairs after a part move. Other stale cuts still
    // appear as errors and block export, but must not trap the operator.
    const issues=cancel?[]:cutProblems([ensure().lines[selected]],editorPost(getSheet(),getNest(),settings()),settings());
    if(cancel||issues.length){getSheet().scrapCuts=g.original;cache=null;draw();if(issues.length)message(issues[0]+' Cut restored.',true);return;}
    if(JSON.stringify(g.original?.lines)===JSON.stringify(ensure().lines)){draw();return;}
    if(!cutProblems(ensure().lines,editorPost(getSheet(),getNest(),settings()),settings()).length)
      ensure().layout=layoutStamp(getSheet(),getNest());
    delete ensure().routes;record(g.before);
  }
  $('cutMode').onclick=()=>{finish(true);active=!active;drawing=false;if(active)$('cutShow').checked=true;selectParts([]);draw();};
  $('cutDraw').onclick=()=>{active=true;drawing=!drawing;$('cutShow').checked=true;selectParts([]);draw();};
  function suggest(mode){action(()=>{
    if(suggestion){suggestion.worker.terminate();suggestion=null;draw();message('Suggestion cancelled. Existing cuts preserved.');return;}
    finish(true);
    const target=getSheet(),n=getNest(),config=settings(),stamp=layoutStamp(target,n),previous=JSON.stringify(target.scrapCuts),initialSheets=serial();
    const apply=result=>{
      if(target!==getSheet()||layoutStamp(target,getNest())!==stamp||JSON.stringify(target.scrapCuts)!==previous||serial()!==initialSheets){draw();message('Sheet changed while planning; suggestion discarded. Your edits are preserved.',true);return;}
      const before=serial();if(result.placements)target.placements=result.placements;
      if(result.plan)target.scrapCuts=result.plan;
      active=true;drawing=false;$('cutShow').checked=true;selected=-1;selectParts([]);record(before);
      const added=result.summary?.added?.length||0;
      $('cutSuggestionMessage').textContent=(mode==='cuts'?'':`${added} crate part(s) added to this sheet. `)
        +(mode==='crates'?'Existing bed parts stayed put. Recheck existing cuts after adding parts.':result.plan?.suggestion?.complete?'Suggestion passes the drawing checks; verify the actual post before release.':'Draft suggestion: unresolved waste is marked in red. Narrow gaps need part spacing changes; extra little cuts cannot fix them.')
        +(result.plan?.suggestion?.layoutIssues?.length?' Change spacing: '+result.plan.suggestion.layoutIssues.slice(0,4).map(p=>`${p.a} / ${p.b}: ${p.width.toFixed(1)} mm waste`).join('; ')+'.':'');
    };
    const input={sheet:target,nest:{sheetL:n.sheetL,sheetW:n.sheetW,gap:n.gap,edge:n.edge},settings:config,mode,crate:getCrateOptions()};
    if(typeof window.Worker!=='function'){apply(suggestSheet(input));return;}
    const worker=new window.Worker(new URL('./scrap_worker.mjs?v=4.42',import.meta.url),{type:'module'});
    suggestion={worker};draw();message(`Calculating ${mode==='crates'?'crate placements':mode==='both'?'crate placements and scrap cuts':'scrap cuts'}. You can keep editing or cancel the suggestion.`);
    worker.onmessage=({data})=>{if(suggestion?.worker!==worker)return;worker.terminate();suggestion=null;if(data.error){draw();message(data.error,true);}else apply(data);};
    worker.onerror=()=>{if(suggestion?.worker!==worker)return;worker.terminate();suggestion=null;draw();message('Suggestion could not run. Existing cuts preserved; draw or edit cuts manually.',true);};
    worker.postMessage(input);
  });}
  $('cutSuggest').onclick=()=>suggest('cuts');$('crateSuggest').onclick=()=>suggest('crates');$('bothSuggest').onclick=()=>suggest('both');
  $('cutOptimize').onclick=()=>action(()=>{const before=serial(),ed=ensure();ed.lines=normalizeCuts(ed.lines,editorPost(getSheet(),getNest(),settings()),settings());delete ed.routes;routeIndex=0;selected=-1;record(before);});
  $('cutPath').onchange=()=>{routeIndex=Number($('cutPath').value)||0;$('cutNumbers').checked=true;draw();};
  for(const [id,delta] of [['cutEarlier',-1],['cutLater',1],['cutReverse',0]])$(id).onclick=()=>action(()=>{
    const before=serial(),ed=ensure(),routes=routesFor(ed);if(!routes[routeIndex])return;
    if(delta){const to=routeIndex+delta;if(to<0||to>=routes.length)return;[routes[to],routes[routeIndex]]=[routes[routeIndex],routes[to]];routeIndex=to;}
    else routes[routeIndex].reverse();ed.routes=routes;record(before);
  });
  $('cutRecheck').onclick=()=>action(()=>{const ed=ensure(),bad=cutProblems(ed.lines,editorPost(getSheet(),getNest(),settings()),settings());if(bad.length)throw Error(bad[0]);const before=serial();ed.layout=layoutStamp(getSheet(),getNest());record(before);});
  $('cutDelete').onclick=remove;
  $('cutClear').onclick=()=>{const before=serial();delete getSheet().scrapCuts;selected=-1;record(before);};
  $('cutUndo').onclick=()=>action(()=>{const h=history.at(-1);if(!h)throw Error('Nothing to undo.');if(serial()!==h.after)throw Error('Parts changed since this action; undo is unavailable so those edits are preserved.');getNest().sheets=JSON.parse(h.before);history.pop();selectParts([]);selected=-1;cache=null;changed();draw();$('cutSuggestionMessage').textContent='Last edit undone. The restored sheet is shown.';});
  $('cutPhase').onchange=()=>action(()=>{finish(true);const before=serial(),ed=ensure();ed.settings.phase=$('cutPhase').value;checkScrapPhase(ed);delete ed.routes;record(before);});
  $('cutPhaseAll').onclick=()=>action(()=>{finish(true);const before=serial(),phase=$('cutPhase').value;checkScrapPhase({settings:{phase}});for(const sh of getNest().sheets)if(sh.scrapCuts){sh.scrapCuts.settings={...SCRAP_DEFAULTS,...sh.scrapCuts.settings,phase};delete sh.scrapCuts.routes;}record(before);});
  $('cutSkin').onchange=()=>action(()=>{const v=Number($('cutSkin').value);if(!Number.isFinite(v)||v<.2||v>2){$('cutSkin').value=settings().skinMM;$('cutPhase').value=settings().phase;throw Error('Remaining skin must be 0.2-2 mm.');}const before=serial();ensure().settings.skinMM=v;record(before);});
  $('spacePreset').onchange=()=>{$('spaceMax').value=$('spacePreset').value;draw();};
  for(const id of ['spaceMax','spaceSpan','cutShow','cutFlags','cutTravel','cutNumbers','cutMoveAxis'])$(id).onchange=()=>{
    if(id==='cutShow'&&!$(id).checked){finish(true);active=false;drawing=false;}draw();
  };
  for(const [id,axis] of [['spaceRow','x'],['spaceColumn','y']])$(id).onclick=()=>action(()=>{
    const before=serial(),r=distributeSelection(getSheet(),getSelection(),getNest(),axis,Number($('spaceMax').value),9.525,'space-'+Date.now()+'-'+history.length,$('spaceSpan').value||'selection');
    getSheet().placements=r.placements;selectParts(r.selected);record(before);
    $('spaceMessage').textContent=`Spaced ${axis==='x'?'row':'column'} with ${r.gap.toFixed(3)} mm gaps. Parts, layers and rotations preserved. Recheck existing scrap cuts.`;
  });
  svg.addEventListener('pointerdown',e=>{if(!active||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();
    const hit=e.target.closest('[data-cut]'),p=point(e),before=serial(),original=structuredClone(getSheet().scrapCuts);
    if(hit){selected=Number(hit.dataset.cut);gesture={pointerId:e.pointerId,before,original,start:p,line:[...ensure().lines[selected]],handle:hit.dataset.handle};}
    else if(drawing){selected=ensure().lines.length;ensure().lines.push([...p,...p]);gesture={pointerId:e.pointerId,before,original,start:p,line:[...p,...p],handle:'new'};}
    else selected=-1;
    if(gesture)svg.setPointerCapture(e.pointerId);draw();
  },true);
  svg.addEventListener('pointermove',e=>{if(!active)return;e.stopImmediatePropagation();if(!gesture)return;e.preventDefault();
    const p=point(e),g=gesture,l=[...g.line];
    if(g.handle==='new'){l.splice(2,2,...snapped(g.start,p));}
    else if(g.handle==='0'||g.handle==='1'){const i=Number(g.handle)*2,j=2-i,vertical=Math.abs(l[0]-l[2])<.003;l[i]=vertical?l[j]:p[0];l[i+1]=vertical?p[1]:l[j+1];}
    else {
      const dx=p[0]-g.start[0],dy=p[1]-g.start[1],mode=$('cutMoveAxis').value||'auto';
      if(g.axis===undefined){if(mode==='x'||mode==='y')g.axis=mode==='x'?0:1;else if(Math.max(Math.abs(dx),Math.abs(dy))>=2)g.axis=Math.abs(dx)>=Math.abs(dy)?0:1;}
      if(g.axis!==undefined)for(const i of [g.axis,g.axis+2])l[i]=Math.round((l[i]+(g.axis?dy:dx))*1000)/1000;
    }
    ensure().lines[selected]=l;cache=null;draw();
  },true);
  for(const type of ['pointerup','pointercancel'])svg.addEventListener(type,e=>{if(!active)return;e.stopImmediatePropagation();finish(type==='pointercancel');},true);
  window.addEventListener('keydown',e=>{if(!active||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
    if(e.key==='Escape'){e.stopImmediatePropagation();finish(true);selected=-1;drawing=false;draw();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopImmediatePropagation();remove();}
    else if(e.key.startsWith('Arrow')){e.preventDefault();e.stopImmediatePropagation();if(selected<0)return;
      action(()=>{const before=serial(),ed=ensure(),l=[...ed.lines[selected]],axis=['ArrowLeft','ArrowRight'].includes(e.key)?0:1;
        const delta=(e.shiftKey?10:1)*(['ArrowLeft','ArrowDown'].includes(e.key)?-1:1);l[axis]+=delta;l[axis+2]+=delta;
        const errors=cutProblems([l],editorPost(getSheet(),getNest(),settings()),settings());if(errors.length)throw Error(errors[0]);
        ed.lines[selected]=l;delete ed.routes;record(before);});
    }else if(/^[rR]$/.test(e.key)){e.stopImmediatePropagation();}
  },true);
  return {
    partMode(){finish(true);active=false;drawing=false;selected=-1;},
    overlay(){const s=getSheet(),n=getNest();if(s!==lastSheet){lastSheet=s;selected=-1;gesture=null;cache=null;routeIndex=0;lastOrderKey='';
      const issues=s?.scrapCuts?.suggestion?.layoutIssues||[];
      $('cutSuggestionMessage').textContent=issues.length?'Change spacing: '+issues.slice(0,4).map(p=>`${p.a} / ${p.b}: ${p.width.toFixed(1)} mm waste`).join('; ')+'.':'Suggestions preserve existing bed parts. Crate quantities apply across the whole job.';
    }
      $('cutSuggest').textContent=suggestion?'Cancel suggestion':'Suggest scrap cuts';
      $('crateSuggest').disabled=$('bothSuggest').disabled=!!suggestion;
      const selection=getSelection();
      $('spaceRow').disabled=$('spaceColumn').disabled=selection.length<2;
      if(selection.length<2)$('spaceMessage').textContent='Select two or more parts for an equal-gap preview.';
      else {
        const previews=[];for(const [axis,label] of [['x','Row'],['y','Column']])try{
          const p=spacingPreview(s,selection,n,axis,Number($('spaceMax').value),9.525,$('spaceSpan').value||'selection');
          previews.push(`${label}: ${p.gap.toFixed(3)} mm gaps${p.problem?' — '+p.problem:''}`);
        }catch(e){if(!e.message.includes('common band'))previews.push(`${label}: ${e.message}`);}
        $('spaceMessage').textContent=previews.join(' | ')||'These parts do not form a common row or column.';
      }
      $('cutMode').setAttribute('aria-pressed',String(active));$('cutDraw').setAttribute('aria-pressed',String(drawing));
      $('cutSkin').value=settings().skinMM;$('cutPhase').value=settings().phase;$('cutDelete').disabled=selected<0;$('cutUndo').disabled=!history.length;
      const ed=s?.scrapCuts;let routes=[],routeError='';try{routes=ed?(gesture?cutRoutes(ed.lines):routesFor(ed)):[];}catch(e){routeError=e.message;routes=ed?cutRoutes(ed.lines):[];}
      routeIndex=Math.min(routeIndex,Math.max(0,routes.length-1));
      const orderKey=JSON.stringify(routes);if(orderKey!==lastOrderKey){lastOrderKey=orderKey;$('cutPath').innerHTML=routes.map((p,i)=>`<option value="${i}">Path ${i+1} · ${(routeLines([p]).reduce((v,l)=>v+Math.hypot(l[2]-l[0],l[3]-l[1]),0)/1000).toFixed(2)} m</option>`).join('');}
      $('cutPath').value=String(routeIndex);$('cutPath').disabled=!routes.length;
      $('cutEarlier').disabled=!routes.length||routeIndex===0;$('cutLater').disabled=!routes.length||routeIndex===routes.length-1;$('cutReverse').disabled=!routes.length;
      if(!ed){message(drawing?'Drag from the start to the end of a new cut. It snaps horizontal or vertical.':'Suggest scrap cuts, add crate parts, or use + Add cut and drag across empty waste.');return '';}
      const xy=p=>`${20+p[0]} ${20+n.sheetW-p[1]}`;let g='';
      if(!gesture){const r=report(),stale=ed.layout!==layoutStamp(s,n);
        message(`${drawing?'ADD CUT: drag start → end. ':''}${settings().phase==='after-outlines'?'AFTER outlines → left-middle unload. ':''}${routeError?routeError+' ':''}${stale?'PARTS MOVED — recheck. ':''}${routes.length} continuous paths · ~${estimateRouteTime(routes,{skin:settings().skinMM,finish:[0,n.sheetW/2]}).toFixed(1)} s modeled (assumed motion) · ${(routeLines(routes).reduce((v,l)=>v+Math.hypot(l[2]-l[0],l[3]-l[1]),0)/1000).toFixed(2)} m down-feed · ${(routeLines(routes).reduce((o,l)=>({at:l.slice(2),v:o.v+Math.hypot(o.at[0]-l[0],o.at[1]-l[1])}),{at:[0,0],v:0}).v/1000).toFixed(2)} m travel · ${settings().skinMM} mm skin. ${r.errors[0]||`${r.oversize.length} over 12″; ${r.slivers.length} under 2″. ${r.oversize.length||r.slivers.length?'DRAFT — resolve red waste flags before export.':'Drawing checks pass; native post must also pass.'}`}`,!!routeError||stale||r.errors.length>0||r.oversize.length>0||r.slivers.length>0);
        if($('cutFlags').checked!==false)for(const p of [...new Set([...r.oversize,...r.slivers])]){const [a,b,c,d]=p.box;g+=`<rect x="${20+a}" y="${20+n.sheetW-d}" width="${c-a}" height="${d-b}" fill="none" stroke="var(--bad)" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"><title>${p.reason||`Modeled scrap ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches`}</title></rect>`;}
      }
      let at=[0,0];if($('cutTravel').checked===true)for(const route of routes){g+=`<path d="M${xy(at)} L${xy(route[0])}" stroke="var(--soft)" opacity=".5" stroke-dasharray="4 5" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"/>`;at=route.at(-1);}
      if($('cutShow').checked!==false&&$('cutNumbers').checked!==false)routes.forEach((p,i)=>{
        const scale=(svg.getBoundingClientRect?.().width||n.sheetL+40)/(n.sheetL+40),labelR=13/scale,labelFont=14/scale;
        const a=p[0],b=p[1],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
        const tip=[a[0]+dx/len*42,a[1]+dy/len*42],left=[tip[0]-dx/len*12-dy/len*7,tip[1]-dy/len*12+dx/len*7],right=[tip[0]-dx/len*12+dy/len*7,tip[1]-dy/len*12-dx/len*7];
        g+=`<g pointer-events="none"><circle cx="${a[0]+20}" cy="${20+n.sheetW-a[1]}" r="${labelR}" fill="var(--board)" stroke="${i===routeIndex?'var(--accent)':'var(--fence)'}" vector-effect="non-scaling-stroke"/><text x="${a[0]+20}" y="${20+n.sheetW-a[1]}" font-size="${labelFont}" text-anchor="middle" dominant-baseline="middle" fill="var(--ink)">${i+1}</text><path d="M${xy(left)} L${xy(tip)} L${xy(right)}" fill="none" stroke="var(--fence)" stroke-width="2" vector-effect="non-scaling-stroke"/></g>`;
      });
      if($('cutShow').checked!==false&&settings().phase==='after-outlines')for(const route of routes)g+=`<path d="${route.map((p,i)=>(i?'L':'M')+xy(p)).join(' ')}" stroke="var(--accent)" opacity=".65" stroke-width="2" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"><title>After-outline route; perimeter connections checked against the native post</title></path>`;
      if($('cutShow').checked!==false)ed.lines.forEach((l,i)=>{const a=l.slice(0,2),b=l.slice(2),d=`M${xy(a)} L${xy(b)}`;
        g+=`<path d="${d}" stroke="${i===selected?'var(--accent)':'var(--fence)'}" stroke-width="3" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        if(active)g+=`<path data-cut="${i}" d="${d}" stroke="transparent" stroke-width="15" fill="none" vector-effect="non-scaling-stroke" style="cursor:move"/>`;
        if(active&&i===selected)for(const [j,p] of [a,b].entries())g+=`<circle data-cut="${i}" data-handle="${j}" cx="${20+p[0]}" cy="${20+n.sheetW-p[1]}" r="13" fill="var(--board)" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" style="cursor:crosshair"/>`;
      });return g;
    }
  };
}
