// All coordinates here use the nest/editor frame: x right, y UP.
// Placement changes translate parts; they never mirror a shape or rotate drilling.
export function makePolicy({partBox, smallPartBuffer, nestViolations, packSingleSheet, defaults}) {
  const config = o => ({...defaults,...o});
  const product = p => !p.salvage && !p.remnant;
  const layers = ps => [...new Set(ps.filter(product).map(p=>p.layer))].sort((a,b)=>a-b);
  const count = sh => sh.placements.filter(product).length;
  function legal(ps, o) {
    return ps.every(p=>{const [a,b,c,d]=partBox(p); return a>=o.edge-.01 && c>=o.edge-.01 && b<=o.sheetL-o.edge+.01 && d<=o.sheetW-o.edge+.01;})
      && !nestViolations({...o,sheets:[{placements:ps}]}).length;
  }
  function holdRisk(ps, opts) {
    const o=config(opts);
    return ps.filter(product).reduce((sum,p)=>{
      if(Math.min(p.l,p.w)>=o.skinnyMM)return sum;
      const [a,b,c,d]=partBox(p), x=Math.min(a-o.edge,o.sheetL-o.edge-b), y=Math.min(c-o.edge,o.sheetW-o.edge-d);
      return sum+(Math.min(x,y)<o.skinnyInset-.01?1:0)+(x<o.cornerMM-.01&&y<o.cornerMM-.01?1:0);
    },0);
  }
  // Equal areas have equal target positions. Remnants do not affect the ranking.
  function vacuumScore(ps, opts) {
    const o=config(opts), list=ps.filter(product), areas=list.map(p=>p.l*p.w).sort((a,b)=>a-b);
    if(list.length<2 || areas[0]===areas.at(-1))return 0;
    return list.reduce((sum,p)=>{
      const [a,b,c,d]=partBox(p), area=p.l*p.w;
      const lower=areas.filter(v=>v<area).length, equal=areas.filter(v=>v===area).length;
      const rank=(lower+(equal-1)/2)/(areas.length-1);
      const pos=((a+b)/2/o.sheetL + 1-(c+d)/2/o.sheetW)/2;
      return sum+(pos-rank)**2;
    },0)/list.length;
  }
  // Same skyline strategy as Quarry's nest-rearrange proposal, in the editor's
  // y-up frame, with the recipe's spacing/buffers instead of a hard-coded gap.
  function skyline(ps,o,ascending) {
    const W=o.sheetL-2*o.edge,H=o.sheetW-2*o.edge;
    const order=ps.map(p=>{const [a,b,c,d]=partBox(p),pad=smallPartBuffer(p,o);return {p,pad,w:b-a+2*pad,h:d-c+2*pad};})
      .sort((a,b)=>(ascending?1:-1)*(a.p.l*a.p.w-b.p.l*b.p.w)||b.h-a.h);
    let sky=[[0,W+o.gap,0]], out=[];
    for(const item of order){
      const {p,pad,w,h}=item,iw=w+o.gap,ih=h+o.gap;
      let best=null;
      for(const [x] of sky){
        if(x+iw>W+o.gap+1e-6)continue;
        const y=Math.max(0,...sky.filter(([a,b])=>b>x&&a<x+iw).map(s=>s[2]));
        if(y+ih>H+o.gap+1e-6)continue;
        if(!best||y<best.y-1e-6||Math.abs(y-best.y)<1e-6&&x<best.x)best={x,y};
      }
      if(!best)return null;
      const {x,y}=best;
      out.push({...p,x:o.edge+(ascending?x:W-x-w)+pad,y:o.edge+(ascending?H-y-h:y)+pad});
      const next=[];
      for(const [a,b,z] of sky){
        if(b<=x||a>=x+iw)next.push([a,b,z]);
        else {if(a<x)next.push([a,x,z]);if(b>x+iw)next.push([x+iw,b,z]);}
      }
      next.push([x,x+iw,y+ih]);next.sort((a,b)=>a[0]-b[0]);sky=next;
    }
    return out;
  }
  function arrange(ps,opts){
    const o=config(opts);
    // Pinned salvage/remnants retain their positions. A shuffle must not
    // turn a saved remnant into an unrecorded machining move.
    if(ps.some(p=>!product(p)))return ps;
    let best=ps, risk=holdRisk(ps,o), score=vacuumScore(ps,o);
    const consider=c=>{
      if(!c||!legal(c,o))return;
      const r=holdRisk(c,o), s=vacuumScore(c,o);
      if(r<risk||r===risk&&s<score-1e-10){best=c;risk=r;score=s;}
    };
    for(const flipX of [false,true])for(const flipY of [false,true])consider(ps.map(p=>{
      const [a,b,c,d]=partBox(p);return {...p,x:flipX?o.sheetL-b:a,y:flipY?o.sheetW-d:c};
    }));
    consider(skyline(ps,o,true));consider(skyline(ps,o,false));
    return best;
  }
  function balance(nest,opts={}){
    const o=config({...nest,...opts}), cap=Number(o.maxLayersPerSheet)||Number(nest.cap)||Number.MAX_SAFE_INTEGER;
    const sheets=nest.sheets.map(s=>({...s,placements:s.placements.map(p=>({...p}))}));
    const before=sheets.map(count);
    const repack=(ps,tries=12)=>{
      for(let t=0;t<tries;t++){
        const packed=packSingleSheet(ps.map((q,i)=>({...q,key:String(i),allowedRotations:[q.rotation]})),o,
          {heur:['bssf','blsf','baf','bl'][t%4],seed:t*2654435761+13,jitter:t*.8});
        const trial=packed?.map(q=>({...ps[Number(q.key)],x:q.x,y:q.y,rotation:q.rotation}));
        if(trial&&legal(trial,o))return arrange(trial,o);
      }
      return null;
    };
    const pairLayersOkay=(a,b,fromParts,toParts)=>{
      const f=layers(fromParts),t=layers(toParts);
      const lo=a<b?f:t,hi=a<b?t:f;
      return f.length<=cap&&t.length<=cap&&lo[0]<=hi[0]&&lo.at(-1)<=hi.at(-1);
    };
    // Transfers only cross a shared sheet boundary. Keep monotone layer ranges
    // and the user's layer cap; never add a sheet for more even labels.
    let moves=0,changed=true;
    while(changed){
      changed=false;
      const pairs=[];
      for(let i=0;i<sheets.length-1;i++)for(const [a,b] of [[i,i+1],[i+1,i]])
        if(count(sheets[a])-count(sheets[b])>1)pairs.push({a,b,diff:count(sheets[a])-count(sheets[b])});
      pairs.sort((a,b)=>b.diff-a.diff||a.a-b.a);
      for(const {a,b} of pairs){
        const from=sheets[a],to=sheets[b];
        if([...from.placements,...to.placements].some(p=>!product(p)))continue;
        const candidates=[...from.placements].sort((p,q)=>(a<b?q.layer-p.layer:p.layer-q.layer)||p.l*p.w-q.l*q.w);
        for(const p of candidates){
          const fromParts=from.placements.filter(q=>q!==p), toParts=[...to.placements,p];
          const ranges=sheets.map((s,i)=>layers(i===a?fromParts:i===b?toParts:s.placements));
          if(ranges[a].length>cap||ranges[b].length>cap||!ranges[a].length)continue;
          const lo=Math.min(a,b),hi=Math.max(a,b);
          if(ranges[lo][0]>ranges[hi][0]||ranges[lo].at(-1)>ranges[hi].at(-1))continue;
          let fit=null;
          for(let t=0;t<24&&!fit;t++){
            const packed=packSingleSheet(toParts.map((q,i)=>({...q,key:String(i),allowedRotations:[q.rotation]})),o,
              {heur:['bssf','blsf','baf','bl'][t%4],seed:t*2654435761+13,jitter:t*.8});
            const trial=packed?.map(q=>({...toParts[Number(q.key)],x:q.x,y:q.y,rotation:q.rotation}));
            if(trial&&legal(trial,o)&&holdRisk(trial,o)<=holdRisk(toParts,o))fit=trial;
          }
          if(!fit)continue;
          from.placements=fromParts;to.placements=fit;
          from.layers=ranges[a];to.layers=ranges[b];moves++;changed=true;break;
        }
        if(changed)break;
      }
      // A sparse sheet can be full of large panels: there is no room for a
      // simple transfer. Exchange two small panels for one large panel, then
      // re-pack BOTH sheets. Every accepted exchange reduces count variance.
      if(!changed)for(const {a,b} of pairs){
        const from=sheets[a],to=sheets[b];
        if([...from.placements,...to.placements].some(p=>!product(p)))continue;
        const donors=[...from.placements].sort((p,q)=>p.l*p.w-q.l*q.w);
        const receivers=[...to.placements].sort((p,q)=>q.l*q.w-p.l*p.w);
        const oldRisk=holdRisk(from.placements,o)+holdRisk(to.placements,o);
        for(const q of receivers){
          for(let i=0;i<donors.length&&!changed;i++)for(let j=i+1;j<donors.length&&!changed;j++){
            const p=donors[i],r=donors[j];
            if(p.l*p.w+r.l*r.w>=q.l*q.w)continue;
            const fp=[...from.placements.filter(v=>v!==p&&v!==r),q];
            const tp=[...to.placements.filter(v=>v!==q),p,r];
            if(!pairLayersOkay(a,b,fp,tp))continue;
            if(fp.reduce((s,v)=>s+v.l*v.w,0)>(o.sheetL-2*o.edge)*(o.sheetW-2*o.edge))continue;
            const f=repack(fp,8);if(!f)continue;
            const t=repack(tp,8);if(!t||holdRisk(f,o)+holdRisk(t,o)>oldRisk)continue;
            from.placements=f;to.placements=t;from.layers=layers(f);to.layers=layers(t);
            moves++;changed=true;
          }
          if(changed)break;
        }
        if(changed)break;
      }
    }
    for(const sh of sheets){
      sh.placements=arrange(sh.placements,o);
      sh.layers=layers(sh.placements);
      sh.utilization=+(sh.placements.reduce((s,p)=>s+p.l*p.w,0)/(o.sheetL*o.sheetW)).toFixed(3);
    }
    return {...nest,sheets,balance:{before,after:sheets.map(count),moves}};
  }
  return {vacuumScore,holdRisk,arrange,balance,legal};
}
