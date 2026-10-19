import {pointInOutline,segmentOutlineDistance} from './scrap_native_geometry.mjs?v=4.68';
const STEP=1;
function rectangle(box){const[a,b,c,d]=box;return[[a,b],[c,b],[c,d],[a,d]]}
export function wasteSpans(post,lines,axis,pos){
  const t=1-axis,covered=[];
  for(const p of post.parts){const pts=p.outline||rectangle(p.box),xs=[];
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];
      if((a[t]>pos)!==(b[t]>pos))xs.push(a[axis]+(b[axis]-a[axis])*(pos-a[t])/(b[t]-a[t]));}
    xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)covered.push([xs[i],xs[i+1]]);
  }
  for(const c of [...post.contours.flat(),...lines]){
    const r=post.radius,a=c.slice(0,2),b=c.slice(2),parallel=Math.abs(a[t]-b[t])<.003;
    const delta=parallel?Math.abs(pos-a[t]):Math.max(Math.min(a[t],b[t])-pos,pos-Math.max(a[t],b[t]),0);
    if(delta>=r)continue;const fringe=Math.sqrt(r*r-delta*delta);
    covered.push(parallel?[Math.min(a[axis],b[axis])-fringe,Math.max(a[axis],b[axis])+fringe]:[a[axis]-fringe,a[axis]+fringe]);
  }
  const limit=axis===0?post.width:post.height;let reach=0;const free=[];
  for(const[a,b]of covered.sort((a,b)=>a[0]-b[0])){if(b<=reach||a>=limit)continue;if(a>reach)free.push([reach,Math.min(a,limit)]);reach=Math.max(reach,b);if(reach>=limit)break}
  if(reach<limit)free.push([reach,limit]);return free;
}
export function narrowCorridors(post,lines,minWidth){
  const flags=[];
  for(const axis of [0,1]){
    const limit=axis===0?post.height:post.width;let tracks=[];
    const finish=t=>{if(t.last-t.start+STEP>=minWidth){const box=axis===0?[t.minLo,t.start,t.minHi,t.last+STEP]:[t.start,t.minLo,t.last+STEP,t.minHi];flags.push({box,width:box[2]-box[0],height:box[3]-box[1],area:(t.hi-t.lo)*(t.last-t.start+STEP),measuredWidthMM:t.minHi-t.minLo,nativeScan:true,axis})}};
    for(let pos=.05;pos<limit-.05;pos+=STEP){const used=new Set(),next=[];
      for(const[lo,hi]of wasteSpans(post,lines,axis,pos).filter(([a,b])=>b-a>.02&&b-a<minWidth-.02)){
        let best=-1,overlap=0;for(let i=0;i<tracks.length;i++)if(!used.has(i)){const n=Math.min(hi,tracks[i].hi)-Math.max(lo,tracks[i].lo);if(n>overlap){overlap=n;best=i}}
        const old=best<0?null:tracks[best];if(old)used.add(best);const minimum=old&&old.minHi-old.minLo<=hi-lo?old:{minLo:lo,minHi:hi};next.push({lo,hi,start:old?.start??pos,last:pos,minLo:minimum.minLo,minHi:minimum.minHi});
      }
      tracks.forEach((t,i)=>{if(!used.has(i))finish(t)});tracks=next;
    }
    tracks.forEach(finish);
  }
  return flags;
}
export function retainedNarrowCorridors(post,lines,minWidth){
  const flags=narrowCorridors(post,lines,minWidth);if(!lines.length)return flags;
  // Chopping a narrow corridor into short chips must never make its width
  // warning disappear. Hogging may clear it only when no standing strip remains.
  for(const base of narrowCorridors(post,[],minWidth)){
    if(flags.some(f=>f.axis===base.axis&&f.box.every((v,i)=>Math.abs(v-base.box[i])<2)))continue;
    const axis=base.axis,t=1-axis,b=base.box;
    for(let pos=b[t];pos<b[t+2];pos+=STEP){
      const span=wasteSpans(post,lines,axis,pos).find(([a,c])=>Math.min(c,b[axis+2])-Math.max(a,b[axis])>.02);
      if(span){flags.push({...base,reason:'Narrow placement waste remains after crosscutting. Move parts or clear this internal strip.'});break}
    }
  }
  return flags;
}
function squareFits(post,lines,box){
  const[a,b,c,d]=box;if(a<0||b<0||c>post.width||d>post.height)return false;const rect=rectangle(box);
  for(const p of post.parts){const pts=p.outline||rectangle(p.box);
    if(rect.some(v=>pointInOutline(v,pts))||pts.some(([x,y])=>x>a&&x<c&&y>b&&y<d))return false;
    if(rect.some((v,i)=>segmentOutlineDistance([...v,...rect[(i+1)%4]],pts)<1e-8))return false;
  }
  return [...post.contours.flat(),...lines].every(l=>segmentOutlineDistance(l,rect)>=post.radius-1e-8);
}
export function hasWasteSquare(post,lines,piece,side){
  const[a,b,c,d]=piece.box,h=side/2;
  const xs=[a+h,c-h,(a+c)/2],ys=[b+h,d-h,(b+d)/2];
  // Allow at most the mesh uncertainty, then prove the whole physical square
  // against native polygons and circular kerfs. This never widens the rule.
  xs.push(a+h-2,c-h+2);ys.push(b+h-2,d-h+2);
  if(xs.some(x=>ys.some(y=>squareFits(post,lines,[x-h,y-h,x+h,y+h]))))return true;
  // Exactly minimum-width bands can lie between mesh-cell boundaries. Use
  // their real circular-sweep intersections, not a rounded mesh midpoint.
  for(const x of xs)for(const[lo,hi]of wasteSpans(post,lines,1,x)){
    if(hi-lo<side-1e-8||hi<b||lo>d)continue;
    for(const y of [lo+h,hi-h,(lo+hi)/2]){
      if(y<b-h-2||y>d+h+2)continue;
      if(squareFits(post,lines,[x-h,y-h,x+h,y+h]))return true;
      for(const[u,v]of wasteSpans(post,lines,0,y))if(v-u>=side-1e-8&&v>=a&&u<=c)
        for(const z of [u+h,v-h,(u+v)/2])if(z>=a-h-2&&z<=c+h+2&&squareFits(post,lines,[z-h,y-h,z+h,y+h]))return true;
    }
  }
  return false;
}

// The preview mesh may disconnect a tiny curved tip from its parent offcut.
// Remove that flag only after proving a continuous path through actual native
// material to a broad raster island. Each graph edge is checked against every
// finished polygon and every circular cutter sweep; proximity alone is no proof.
export function nativeTipConnected(post,lines,piece,raster,islands){
  const CELL=2,first=piece.cells.values().next().value;
  const start=[(first%raster.nx+.5)*CELL,(Math.floor(first/raster.nx)+.5)*CELL];
  const broad=islands.filter(p=>p!==piece&&p.area>400),sweeps=[...post.contours.flat(),...lines].map(c=>[c.slice(0,2),c.slice(2)]);
  if(!broad.length)return false;
  const clear=line=>{
    if(Math.min(line[0],line[2])<0||Math.min(line[1],line[3])<0||Math.max(line[0],line[2])>post.width||Math.max(line[1],line[3])>post.height)return false;
    if(post.parts.some(p=>segmentOutlineDistance(line,p.outline||rectangle(p.box))<1e-8))return false;
    return sweeps.every(c=>segmentOutlineDistance(line,c)>post.radius+1e-8);
  };
  if(!clear([...start,...start]))return false;
  for(const step of [.5,.125]){
    const reach=Math.ceil(6/step),queue=[[0,0]],seen=new Set(['0,0']);
    for(let at=0;at<queue.length;at++){
      const[i,j]=queue[at],x=start[0]+i*step,y=start[1]+j*step;
      const ci=Math.floor(x/CELL),cj=Math.floor(y/CELL),cell=ci+cj*raster.nx;
      if(ci>=0&&ci<raster.nx&&cj>=0&&cj<raster.ny&&broad.some(p=>p.cells.has(cell))&&clear([x,y,(ci+.5)*CELL,(cj+.5)*CELL]))return true;
      for(const[di,dj]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
        const a=i+di,b=j+dj,key=a+','+b;if(Math.abs(a)>reach||Math.abs(b)>reach||seen.has(key))continue;
        seen.add(key);if(clear([x,y,start[0]+a*step,start[1]+b*step]))queue.push([a,b]);
      }
    }
  }
  return false;
}

