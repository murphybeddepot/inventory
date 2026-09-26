import {SCRAP_DEFAULTS,layoutStamp,editorPost,cutProblems,analyzeCuts,normalizeCuts,suggestCuts} from './scrap_editor.mjs?v=4.39';
import {cutRoutes,routeLines} from './scrap_routes.mjs?v=4.39';
import {distributeSelection,spacingPreview} from './nest_spacing.mjs?v=4.39';

// The editor owns intent; native posting rechecks against the actual tool and
// part contours. Capture-phase handlers keep scrap gestures out of part moves.
export function installScrapControls({document,window,getNest,getSheet,getSelection,selectParts,changed,draw}) {
  const $=id=>document.getElementById(id),svg=$('board');
  let active=false,drawing=false,selected=-1,gesture=null,lastSheet=null,cache=null;
  let suggestion=null;
  const history=[];
  const settings=()=>({...SCRAP_DEFAULTS,...getSheet()?.scrapCuts?.settings});
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
  function remove(){if(selected<0)return;const before=serial();ensure().lines.splice(selected,1);selected=-1;record(before);}
  function finish(cancel=false){if(!gesture)return;const g=gesture;gesture=null;
    if(svg.hasPointerCapture(g.pointerId))svg.releasePointerCapture(g.pointerId);
    // Permit one-at-a-time repairs after a part move. Other stale cuts still
    // appear as errors and block export, but must not trap the operator.
    const issues=cancel?[]:cutProblems([ensure().lines[selected]],editorPost(getSheet(),getNest(),settings()),settings());
    if(cancel||issues.length){getSheet().scrapCuts=g.original;cache=null;draw();if(issues.length)message(issues[0]+' Cut restored.',true);return;}
    if(!cutProblems(ensure().lines,editorPost(getSheet(),getNest(),settings()),settings()).length)
      ensure().layout=layoutStamp(getSheet(),getNest());
    record(g.before);
  }
  $('cutMode').onclick=()=>{finish(true);active=!active;drawing=false;if(active)$('cutShow').checked=true;selectParts([]);draw();};
  $('cutDraw').onclick=()=>{active=true;drawing=!drawing;$('cutShow').checked=true;selectParts([]);draw();};
  $('cutSuggest').onclick=()=>action(()=>{
    if(suggestion){suggestion.worker.terminate();suggestion=null;draw();message('Suggestion cancelled. Existing cuts preserved.');return;}
    finish(true);
    const target=getSheet(),n=getNest(),config=settings(),stamp=layoutStamp(target,n),previous=JSON.stringify(target.scrapCuts);
    const apply=plan=>{
      if(target!==getSheet()||layoutStamp(target,getNest())!==stamp||JSON.stringify(target.scrapCuts)!==previous){draw();message('Sheet changed while planning; suggestion discarded. Your edits are preserved.',true);return;}
      const before=serial();target.scrapCuts=plan;active=true;drawing=false;$('cutShow').checked=true;selected=-1;selectParts([]);record(before);
    };
    if(typeof window.Worker!=='function'){apply(suggestCuts(target,n,config));return;}
    const worker=new window.Worker(new URL('./scrap_worker.mjs?v=4.39',import.meta.url),{type:'module'});
    suggestion={worker};draw();message('Calculating scrap cuts. You can keep editing or cancel the suggestion.');
    worker.onmessage=({data})=>{if(suggestion?.worker!==worker)return;worker.terminate();suggestion=null;if(data.error){draw();message(data.error,true);}else apply(data.plan);};
    worker.onerror=()=>{if(suggestion?.worker!==worker)return;worker.terminate();suggestion=null;draw();message('Suggestion could not run. Existing cuts preserved; draw or edit cuts manually.',true);};
    worker.postMessage({sheet:target,nest:{sheetL:n.sheetL,sheetW:n.sheetW},settings:config});
  });
  $('cutOptimize').onclick=()=>action(()=>{const before=serial(),ed=ensure();ed.lines=normalizeCuts(ed.lines,editorPost(getSheet(),getNest(),settings()),settings());selected=-1;record(before);});
  $('cutRecheck').onclick=()=>action(()=>{const ed=ensure(),bad=cutProblems(ed.lines,editorPost(getSheet(),getNest(),settings()),settings());if(bad.length)throw Error(bad[0]);const before=serial();ed.layout=layoutStamp(getSheet(),getNest());record(before);});
  $('cutDelete').onclick=remove;
  $('cutClear').onclick=()=>{const before=serial();delete getSheet().scrapCuts;selected=-1;record(before);};
  $('cutUndo').onclick=()=>action(()=>{const h=history.at(-1);if(!h)throw Error('Nothing to undo.');if(serial()!==h.after)throw Error('Parts changed since this action; undo is unavailable so those edits are preserved.');getNest().sheets=JSON.parse(h.before);history.pop();selectParts([]);selected=-1;cache=null;changed();draw();});
  $('cutSkin').onchange=()=>action(()=>{const v=Number($('cutSkin').value);if(!Number.isFinite(v)||v<.2||v>2){$('cutSkin').value=settings().skinMM;throw Error('Remaining skin must be 0.2-2 mm.');}const before=serial();ensure().settings.skinMM=v;record(before);});
  $('spacePreset').onchange=()=>{$('spaceMax').value=$('spacePreset').value;draw();};
  for(const id of ['spaceMax','spaceSpan','cutShow','cutFlags','cutTravel'])$(id).onchange=()=>{
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
    else for(let i=0;i<4;i++)l[i]=Math.round((l[i]+p[i%2]-g.start[i%2])*1000)/1000;
    ensure().lines[selected]=l;cache=null;draw();
  },true);
  for(const type of ['pointerup','pointercancel'])svg.addEventListener(type,e=>{if(!active)return;e.stopImmediatePropagation();finish(type==='pointercancel');},true);
  window.addEventListener('keydown',e=>{if(!active||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
    if(e.key==='Escape'){e.stopImmediatePropagation();finish(true);selected=-1;drawing=false;draw();}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopImmediatePropagation();remove();}
    else if(e.key.startsWith('Arrow')||/^[rR]$/.test(e.key)){e.stopImmediatePropagation();}
  },true);
  return {
    partMode(){finish(true);active=false;drawing=false;selected=-1;},
    overlay(){const s=getSheet(),n=getNest();if(s!==lastSheet){lastSheet=s;selected=-1;gesture=null;cache=null;}
      $('cutSuggest').textContent=suggestion?'Cancel suggestion':'Suggest cuts';
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
      $('cutSkin').value=settings().skinMM;$('cutDelete').disabled=selected<0;$('cutUndo').disabled=!history.length;
      const ed=s?.scrapCuts;if(!ed){message(active?'Draw a horizontal/vertical cut; drag a line or its end handles.':'Scrap cuts: suggest a plan or draw your own. Skin is material left above the spoilboard.');return '';}
      const xy=p=>`${20+p[0]} ${20+n.sheetW-p[1]}`,routes=cutRoutes(normalizeCuts(ed.lines));let g='';
      if(!gesture){const r=report(),stale=ed.layout!==layoutStamp(s,n);
        message(`${stale?'PARTS MOVED — recheck. ':''}${routes.length} continuous paths · ${(r.cutLength/1000).toFixed(2)} m cut · ${(routeLines(routes).reduce((o,l)=>({at:l.slice(2),v:o.v+Math.hypot(o.at[0]-l[0],o.at[1]-l[1])}),{at:[0,0],v:0}).v/1000).toFixed(2)} m travel · ${settings().skinMM} mm skin. ${r.errors[0]||`${r.oversize.length} over 12″; ${r.slivers.length} under 2″. Rectangle model; native post must also pass.`}`,stale||r.errors.length>0||r.oversize.length>0||r.slivers.length>0);
        if($('cutFlags').checked!==false)for(const p of [...new Set([...r.oversize,...r.slivers])]){const [a,b,c,d]=p.box;g+=`<rect x="${20+a}" y="${20+n.sheetW-d}" width="${c-a}" height="${d-b}" fill="none" stroke="var(--bad)" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"><title>Modeled scrap ${(p.width/25.4).toFixed(2)} × ${(p.height/25.4).toFixed(2)} inches</title></rect>`;}
      }
      let at=[0,0];if($('cutTravel').checked===true)for(const route of routes){g+=`<path d="M${xy(at)} L${xy(route[0])}" stroke="var(--soft)" opacity=".5" stroke-dasharray="4 5" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"/>`;at=route.at(-1);}
      if($('cutShow').checked!==false)ed.lines.forEach((l,i)=>{const a=l.slice(0,2),b=l.slice(2),d=`M${xy(a)} L${xy(b)}`;
        g+=`<path d="${d}" stroke="${i===selected?'var(--accent)':'var(--fence)'}" stroke-width="3" fill="none" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
        if(active)g+=`<path data-cut="${i}" d="${d}" stroke="transparent" stroke-width="15" fill="none" vector-effect="non-scaling-stroke" style="cursor:move"/>`;
        if(active&&i===selected)for(const [j,p] of [a,b].entries())g+=`<circle data-cut="${i}" data-handle="${j}" cx="${20+p[0]}" cy="${20+n.sheetW-p[1]}" r="13" fill="var(--board)" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" style="cursor:crosshair"/>`;
      });return g;
    }
  };
}
