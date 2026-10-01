// Connections through verified, already-cut native outline grooves. Scrap
// geometry stays separate from travel geometry so connectors cannot mask a
// missing waste cut or bypass the original no-sliver/12-inch checks.
import {cutRoutes,routeLines} from './scrap_routes.mjs?v=4.47';
const EPS=.003,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const key=p=>p.map(v=>Math.round(v*1000)/1000).join(',');
const pt=k=>k.split(',').map(Number);
export const ROUTING_MOTION={feed:17780,plunge:3810,safe:38.15,approach:25.45,skin:.3,rapid:30000,zrapid:6000,accel:1000,zaccel:500,corner:75,latency:.1,start:[0,0],finish:[0,0]};
export function scrapPhase(edit){return edit?.settings?.phase||'after-outlines';}
function validPhase(phase){if(!['before-outlines','after-outlines'].includes(phase))throw Error('Unknown scrap cutting sequence.');}
function segmentClear(s,post){
  const [x,y,a,b]=s,r=post.radius;
  if(Math.min(x,a)<-r-EPS||Math.max(x,a)>post.width+r+EPS||Math.min(y,b)<-r-EPS||Math.max(y,b)>post.height+r+EPS)return false;
  const vertical=Math.abs(x-a)<EPS;if(!vertical&&Math.abs(y-b)>=EPS)return false;
  return post.parts.every(({box:[u,v,c,d]})=>vertical
    ?!(x>u-r+EPS&&x<c+r-EPS&&Math.max(Math.min(y,b),v-r+EPS)<Math.min(Math.max(y,b),d+r-EPS))
    :!(y>v-r+EPS&&y<d+r-EPS&&Math.max(Math.min(x,a),u-r+EPS)<Math.min(Math.max(x,a),c+r-EPS)));
}
export function grooveNetwork(lines,post){
  const contours=post.contours.flat(),bridges=[];
  for(const l of lines)for(const p of [l.slice(0,2),l.slice(2)])for(const c of contours){
    const vertical=Math.abs(c[0]-c[2])<EPS;
    const q=vertical?[c[0],Math.max(Math.min(c[1],c[3]),Math.min(Math.max(c[1],c[3]),p[1]))]
      :[Math.max(Math.min(c[0],c[2]),Math.min(Math.max(c[0],c[2]),p[0])),c[1]];
    const s=[...p,...q];
    if(dist(p,q)>EPS&&dist(p,q)<=2*post.radius+EPS&&segmentClear(s,post))bridges.push(s);
  }
  // Contours must also be clear of every OTHER finished part. A malformed
  // overlapping layout cannot become permission to traverse through a panel.
  return [...lines,...contours.filter(s=>segmentClear(s,post)),...bridges];
}
export function segmentCovered(s,lines,tolerance=EPS){
  const vertical=Math.abs(s[0]-s[2])<tolerance,t=vertical?1:0,f=1-t;
  if(!vertical&&Math.abs(s[1]-s[3])>=tolerance)return false;
  const lo=Math.min(s[t],s[t+2]),hi=Math.max(s[t],s[t+2]);let reach=lo;
  const spans=lines.filter(l=>Math.abs(l[f]-s[f])<tolerance&&Math.abs(l[f+2]-s[f])<tolerance)
    .map(l=>[Math.min(l[t],l[t+2]),Math.max(l[t],l[t+2])]).sort((a,b)=>a[0]-b[0]);
  for(const [a,b] of spans){if(b<reach)continue;if(a>reach+tolerance)break;reach=Math.max(reach,b);}
  return reach>=hi-tolerance;
}
export function validateGrooveRoutes(routes,lines,post){
  if(!Array.isArray(routes)||routes.some(p=>!Array.isArray(p)||p.length<2||p.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite))))throw Error('Cut order is unreadable. Use Auto join & order.');
  const actual=routeLines(routes),network=grooveNetwork(lines,post);
  if(actual.some(l=>!segmentClear(l,post)||!segmentCovered(l,network)))throw Error('Cut order leaves the verified scrap/perimeter grooves or enters a part. Use Auto join & order.');
  if(lines.some(l=>!segmentCovered(l,actual)))throw Error('Cut order no longer covers every scrap cut. Use Auto join & order.');
  return network;
}
export function grooveGraph(lines){
  const nodes=new Map();const add=(a,b)=>{a=key(a);b=key(b);if(a===b)return;for(const [u,v] of [[a,b],[b,a]]){if(!nodes.has(u))nodes.set(u,new Map());nodes.get(u).set(v,dist(pt(u),pt(v)));}};
  for(const s of lines){const vertical=Math.abs(s[0]-s[2])<EPS,t=vertical?1:0,f=1-t,lo=Math.min(s[t],s[t+2]),hi=Math.max(s[t],s[t+2]),points=[lo,hi];
    for(const o of lines){const ov=Math.abs(o[0]-o[2])<EPS;
      if(vertical===ov){if(Math.abs(s[f]-o[f])<EPS)points.push(...[o[t],o[t+2]].filter(v=>v>lo&&v<hi));}
      else if(o[t]>=lo&&o[t]<=hi&&s[f]>=Math.min(o[f],o[f+2])&&s[f]<=Math.max(o[f],o[f+2]))points.push(o[t]);}
    const sorted=[...new Set(points.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);
    for(let i=1;i<sorted.length;i++)add(vertical?[s[0],sorted[i-1]]:[sorted[i-1],s[1]],vertical?[s[0],sorted[i]]:[sorted[i],s[1]]);
  }
  const cache=new Map();return (a,b)=>{a=key(a);b=key(b);const ck=a+'|'+b;if(cache.has(ck))return cache.get(ck);
    const costs=new Map([[a,0]]),previous=new Map(),done=new Set();let result=null;
    while(true){let u=null,cost=Infinity;for(const [k,v] of costs)if(!done.has(k)&&v<cost){u=k;cost=v;}if(u===null)break;
      if(u===b){const walk=[b];while(walk.at(-1)!==a)walk.push(previous.get(walk.at(-1)));result=walk.reverse().map(pt);break;}done.add(u);
      for(const [v,d] of nodes.get(u)||[])if(cost+d<(costs.get(v)??Infinity)){costs.set(v,cost+d);previous.set(v,u);}}
    cache.set(ck,result);return result;};
}
function motion(d,v,a,u=0,w=0){if(d<EPS)return 0;const peak=Math.min(v,Math.sqrt(a*d+(u*u+w*w)/2));return (Math.max(0,peak-u)+Math.max(0,peak-w))/a+Math.max(0,d-(peak*peak-u*u)/(2*a)-(peak*peak-w*w)/(2*a))/peak;}
function simplify(route){const out=[];for(const p of route){if(out.length&&dist(out.at(-1),p)<EPS)continue;while(out.length>1){const a=out.at(-2),b=out.at(-1),u=[b[0]-a[0],b[1]-a[1]],v=[p[0]-b[0],p[1]-b[1]];if(Math.abs(u[0]*v[1]-u[1]*v[0])<EPS&&u[0]*v[0]+u[1]*v[1]>0)out.pop();else break;}out.push(p);}return out;}
export function estimateRouteTime(routes,options={}){
  const c={...ROUTING_MOTION,...options},feed=c.feed/60;let total=0,at=c.start;
  for(const route of routes){const p=simplify(route);if(p.length<2)continue;
    total+=motion(dist(at,p[0]),c.rapid/60,c.accel);at=p.at(-1);
    const lengths=p.slice(1).map((b,i)=>dist(p[i],b)),caps=[0];
    for(let i=1;i<p.length-1;i++){const a=p[i-1],b=p[i],d=p[i+1],dot=(b[0]-a[0])*(d[0]-b[0])+(b[1]-a[1])*(d[1]-b[1]);caps.push(dot<0?0:Math.min(feed,c.corner));}caps.push(0);
    lengths.forEach((d,i)=>caps[i+1]=Math.min(caps[i+1],Math.sqrt(caps[i]**2+2*c.accel*d)));
    for(let i=lengths.length-1;i>=0;i--)caps[i]=Math.min(caps[i],Math.sqrt(caps[i+1]**2+2*c.accel*lengths[i]));
    total+=lengths.reduce((t,d,i)=>t+motion(d,feed,c.accel,caps[i],caps[i+1]),0);
    total+=motion(c.safe-c.approach,c.zrapid/60,c.zaccel)+motion(c.approach-c.skin,c.plunge/60,c.zaccel)+motion(c.safe-c.skin,c.zrapid/60,c.zaccel)+c.latency;
  }
  return total+motion(dist(at,c.finish),c.rapid/60,c.accel);
}
function nearest(routes,start){const todo=routes.map(p=>[...p]),out=[];let at=start;while(todo.length){let best=0,reverse=false,cost=Infinity;todo.forEach((p,i)=>{for(const rev of [false,true]){const d=dist(at,rev?p.at(-1):p[0]);if(d<cost){cost=d;best=i;reverse=rev;}}});const p=todo.splice(best,1)[0];if(reverse)p.reverse();out.push(p);at=p.at(-1);}return out;}
function reorder(routes,c){
  // Local order/direction search is bounded for interactive use. Never replace
  // an existing candidate with a worse modeled result.
  let best=routes.map(p=>[...p]),score=estimateRouteTime(best,c);const near=nearest(routes,c.start),nscore=estimateRouteTime(near,c);if(nscore<score){best=near;score=nscore;}
  if(routes.length>40)return best;
  for(let round=0;round<8;round++){let next=null;
    for(let i=0;i<best.length;i++)for(let j=i;j<best.length;j++){const trial=[...best.slice(0,i),...best.slice(i,j+1).reverse().map(p=>[...p].reverse()),...best.slice(j+1)],value=estimateRouteTime(trial,c);if(value<score-.0001){score=value;next=trial;}}
    if(!next)break;best=next;
  }return best;
}
export function afterOutlineRoutes(lines,post,options={}){
  const c={...ROUTING_MOTION,...options},shortest=grooveGraph(grooveNetwork(lines,post));
  let routes=reorder(cutRoutes(lines),c),score=estimateRouteTime(routes,c);
  // Bound work for unusually large draft plans; no cuts are dropped.
  if(routes.length<=40)for(let round=0;round<40;round++){
    let winner=null,value=score;
    for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++)for(const ri of [false,true])for(const rj of [false,true]){
      const a=ri?[...routes[i]].reverse():routes[i],b=rj?[...routes[j]].reverse():routes[j],link=shortest(a.at(-1),b[0]);if(!link)continue;
      const joined=[...a,...link.slice(1),...b.slice(1)];
      const kept=routes.filter((_,k)=>k!==i&&k!==j),preserved=[...kept.slice(0,i),joined,...kept.slice(i)];
      for(const trial of [preserved,nearest([...kept,joined],c.start)]){const t=estimateRouteTime(trial,c);
        if(t<value-.0001){value=t;winner=trial;}}}
    if(!winner)break;routes=winner;score=value;
  }
  routes=reorder(routes,c);validateGrooveRoutes(routes,lines,post);return routes;
}
export function checkScrapPhase(edit){const phase=scrapPhase(edit);validPhase(phase);return phase;}
// The editor uses a nominal 3/8-inch bit; the supported native post uses
// 9.500 mm. Snap ONLY points already proven to belong to a modeled perimeter,
// within the supported diameter tolerance. Then validate against native NC.
export function snapNativeGrooves(routes,lines,post,editorRadius){
  if(Math.abs(editorRadius-post.radius)>.025)throw Error('Native/editor groove radius mismatch.');
  const fake={...post,radius:editorRadius,contours:post.parts.map(({box:[a,b,c,d]})=>[[a-editorRadius,b-editorRadius,c+editorRadius,b-editorRadius],[c+editorRadius,b-editorRadius,c+editorRadius,d+editorRadius],[c+editorRadius,d+editorRadius,a-editorRadius,d+editorRadius],[a-editorRadius,d+editorRadius,a-editorRadius,b-editorRadius]])};
  const modeled=fake.contours.flat(),native=post.parts.flatMap(({box:[a,b,c,d]})=>[[a-post.radius,b-post.radius,c+post.radius,b-post.radius],[c+post.radius,b-post.radius,c+post.radius,d+post.radius],[c+post.radius,d+post.radius,a-post.radius,d+post.radius],[a-post.radius,d+post.radius,a-post.radius,b-post.radius]]);
  return routes.map(route=>route.map(p=>{const q=[...p];for(let i=0;i<modeled.length;i++){const s=modeled[i],vertical=Math.abs(s[0]-s[2])<EPS,t=vertical?1:0,f=1-t;if(Math.abs(p[f]-s[f])<EPS&&p[t]>=Math.min(s[t],s[t+2])-EPS&&p[t]<=Math.max(s[t],s[t+2])+EPS)q[f]=native[i][f];}return q.map(v=>Math.round(v*1000)/1000);}));
}
