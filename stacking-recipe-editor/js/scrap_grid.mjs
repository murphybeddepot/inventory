// Plan each connected broad waste area as one aligned grid. Never patch an
// individual oversize box with its own offset crosscuts. Narrow native waste
// is omitted from the search, but remains visible in the final actual-waste
// check: a grid cannot cure a placement sliver.
import {Raster,orderForTravel} from './scrap_geometry.mjs?v=4.66';
const round=n=>Math.round(n*1000)/1000;
export function planAlignedWaste(post,settings,{unsafe=()=>false,valid=()=>true,safe=()=>true,seed=[],focusBox=null}={}){
  // Reserve the cutter diameter for possible skin/fracture fringe, plus two
  // preview cells. This changes planning pitch only; measured residual offcut
  // dimensions remain separate from the conservative conveyor envelope.
  const r=post.radius,min=settings.minPieceMM,max=settings.maxPieceMM-2*r-4,pad=r+settings.clearanceMM;
  const base=new Raster(post.width,post.height);
  // Use the same native shape as drawing, collision checks and waste review.
  // A missing source remains a conservative rectangle with an explicit warning.
  for(const p of post.parts)p.outline?base.clearOutline(p.outline):base.clear(...p.box);
  for(const l of post.contours.flat())base.sweep(l,r);
  const broad=base.opened(base.material,min+1.2),regions=base.islands(broad).filter(p=>p.area>400);
  const lines=seed.map(l=>[...l]),details=[];
  const spans=(axis,fixed,box)=>{
    const t=1-axis,limit=t?post.height:post.width;
    let from=box[t]-r,to=box[t+2]+r;
    if(from<min+2*r)from=-r;if(to>limit-min-2*r)to=limit+r;
    let ranges=[[Math.max(-r,from),Math.min(limit+r,to)]];
    for(const {box:b} of post.parts)if(fixed>=b[axis]-pad-.003&&fixed<=b[axis+2]+pad+.003)
      ranges=ranges.flatMap(([lo,hi])=>b[t+2]+pad<=lo||b[t]-pad>=hi?[[lo,hi]]:[[lo,Math.min(hi,b[t]-pad)],[Math.max(lo,b[t+2]+pad),hi]].filter(([a,b])=>b-a>=2*r));
    return ranges.filter(([lo,hi])=>{
      if(hi-lo<2*r)return false;
      // Short crosscuts of a legitimate two-inch band are allowed. A line
      // crossing only a placement ribbon has no broad waste to divide.
      for(let at=Math.max(0,lo);at<=Math.min(limit,hi);at+=2){
        const x=axis?at:fixed,y=axis?fixed:at;
        const i=Math.floor(x/2),j=Math.floor(y/2);
        if(i>=0&&j>=0&&i<base.nx&&j<base.ny&&broad[i+j*base.nx])return true;
      }
      return false;
    }).map(([lo,hi])=>(axis?[lo,fixed,hi,fixed]:[fixed,lo,fixed,hi]).map(round));
  };
  const coords=(box,axis,phase)=>{
    const lo=box[axis],hi=box[axis+2],length=hi-lo,D=2*r,n=Math.max(1,Math.ceil((length+D)/(max+D)));
    if(n===1)return [];
    // Least divisions of the remaining material, accounting for each removed
    // kerf once. Phase trials can shift the grid to satisfy nearby geometry.
    const section=(length-(n-1)*D)/n,room=Math.max(0,Math.min(max-section,section-min)-2);
    return Array.from({length:n-1},(_,i)=>round(lo+section+r+i*(section+D)+phase*room));
  };
  const measure=(cuts,region)=>{
    const grid=broad.slice();for(const line of cuts)base.sweep(line,r,grid);
    return base.islands(grid,region.cells).filter(p=>p.area>400);
  };
  const oversize=pieces=>pieces.reduce((sum,p)=>sum+(Math.max(p.box[2]-p.box[0],p.box[3]-p.box[1])+2*r>settings.maxPieceMM?p.area:0),0);
  for(const region of regions){
    if(focusBox&&!(region.box[2]>focusBox[0]&&region.box[0]<focusBox[2]&&region.box[3]>focusBox[1]&&region.box[1]<focusBox[3]))continue;
    let best=null;
    for(const px of [0,-1,1])for(const py of [0,-1,1]){
      let trial=[...coords(region.box,0,px).flatMap(x=>spans(0,x,region.box)),...coords(region.box,1,py).flatMap(y=>spans(1,y,region.box))];
      // Evaluate against the whole grid, not the order it happened to be built.
      trial=trial.filter((l,i)=>valid(l)&&!unsafe(l,[...lines,...trial.filter((_,j)=>i!==j)]));
      if(!safe([...lines,...trial]))continue;
      const pieces=measure([...lines,...trial],region),unresolved=oversize(pieces);
      const length=trial.reduce((n,l)=>n+Math.hypot(l[2]-l[0],l[3]-l[1]),0);
      const score=[unresolved,trial.length,length];
      if(!best||score.some((v,i)=>v<best.score[i]&&score.slice(0,i).every((n,j)=>n===best.score[j])))best={lines:trial,score};
    }
    // Remove redundant complete grid lines. No new local divisions are added.
    let selected=best?.lines||[],over=best?.score[0]??oversize(measure(lines,region));
    for(let i=selected.length-1;i>=0;i--){const candidate=selected.filter((_,j)=>j!==i);if(oversize(measure([...lines,...candidate],region))<=over&&safe([...lines,...candidate]))selected=candidate;}
    lines.push(...selected);details.push({box:region.box,cuts:selected.length,unresolvedAreaMM2:over});
  }
  return {lines:orderForTravel(lines,[0,0]),regions:details,method:'aligned-waste-grid'};
}
