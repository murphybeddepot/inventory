// Split intersections into a graph, then cover every cut exactly once. Virtual
// edges pair odd vertices; removing them yields the minimum number of trails
// in each connected component, then optionally join short existing-kerf retraces.
// No connector is cut across unplanned material.
export function cutRoutes(lines,{joinWithinMM=19.05}={}) {
  const key=p=>p.map(v=>Math.round(v*1000)/1000).join(',');
  const nodes=new Map(),edges=[];
  const node=p=>{const k=key(p);if(!nodes.has(k))nodes.set(k,{p:k.split(',').map(Number),edges:[]});return k;};
  const add=(a,b,virtual=false)=>{a=node(a);b=node(b);if(a===b)return;const e={a,b,virtual,id:edges.length};edges.push(e);nodes.get(a).edges.push(e);nodes.get(b).edges.push(e);};
  const seen=new Set();
  for(const s of lines){
    const vertical=Math.abs(s[0]-s[2])<.003,t=vertical?1:0,f=1-t;
    const lo=Math.min(s[t],s[t+2]),hi=Math.max(s[t],s[t+2]),points=[lo,hi];
    for(const o of lines){const ov=Math.abs(o[0]-o[2])<.003;
      if(vertical===ov){if(Math.abs(s[f]-o[f])<.003)points.push(...[o[t],o[t+2]].filter(v=>v>lo&&v<hi));}
      else if(o[t]>lo&&o[t]<hi&&s[f]>=Math.min(o[f],o[f+2])-.003&&s[f]<=Math.max(o[f],o[f+2])+.003)points.push(o[t]);
    }
    const sorted=[...new Set(points.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);
    for(let i=1;i<sorted.length;i++){
      const a=vertical?[s[0],sorted[i-1]]:[sorted[i-1],s[1]],b=vertical?[s[0],sorted[i]]:[sorted[i],s[1]];
      const k=[key(a),key(b)].sort().join('|');if(seen.has(k))continue;seen.add(k);add(a,b);
    }
  }
  const components=[],visited=new Set();
  for(const start of nodes.keys())if(!visited.has(start)){
    const component=[],todo=[start];visited.add(start);
    while(todo.length){const k=todo.pop();component.push(k);for(const e of nodes.get(k).edges){const n=e.a===k?e.b:e.a;if(!visited.has(n)){visited.add(n);todo.push(n);}}}
    components.push(component);
  }
  const trails=[];
  for(const component of components){
    const odds=component.filter(k=>nodes.get(k).edges.length%2);
    while(odds.length){const a=odds.pop(),p=nodes.get(a).p;let best=0,d=Infinity;
      odds.forEach((b,i)=>{const q=nodes.get(b).p,v=Math.hypot(p[0]-q[0],p[1]-q[1]);if(v<d){d=v;best=i;}});
      add(p,nodes.get(odds.splice(best,1)[0]).p,true);
    }
    const used=new Set(),stack=[{node:component[0]}],walk=[];
    while(stack.length){const at=stack.at(-1);const e=nodes.get(at.node).edges.find(e=>!used.has(e.id));
      if(!e){walk.push(stack.pop());continue;}used.add(e.id);stack.push({node:e.a===at.node?e.b:e.a,edge:e});
    }
    walk.reverse();const steps=walk.slice(1).map((v,i)=>({from:walk[i].node,to:v.node,edge:v.edge}));
    const cut=steps.findIndex(s=>s.edge.virtual);const ordered=cut<0?steps:[...steps.slice(cut+1),...steps.slice(0,cut+1)];
    let trail=[];
    for(const s of ordered){if(s.edge.virtual){if(trail.length>1)trails.push(trail);trail=[];continue;}
      if(!trail.length)trail.push(nodes.get(s.from).p);trail.push(nodes.get(s.to).p);
    }
    if(trail.length>1)trails.push(trail);
  }
  // A short retrace through an already planned kerf can replace a complete
  // lift/approach/plunge. Join only straight connectors fully covered by the
  // original geometry, at most two 3/8-inch bit widths. Never cross new waste.
  const covered=(a,b)=>{
    const vertical=Math.abs(a[0]-b[0])<.003;
    if(!vertical&&Math.abs(a[1]-b[1])>=.003)return false;
    const t=vertical?1:0,f=1-t,lo=Math.min(a[t],b[t]),hi=Math.max(a[t],b[t]);
    const intervals=lines.filter(l=>Math.abs(l[f]-a[f])<.003&&Math.abs(l[f+2]-a[f])<.003)
      .map(l=>[Math.min(l[t],l[t+2]),Math.max(l[t],l[t+2])]).sort((x,y)=>x[0]-y[0]);
    let reached=lo;for(const [u,v] of intervals){if(v<reached)continue;if(u>reached+.003)break;reached=Math.max(reached,v);}
    return reached>=hi-.003;
  };
  while(true){let best=null;
    for(let i=0;i<trails.length;i++)for(let j=i+1;j<trails.length;j++)for(const ri of [false,true])for(const rj of [false,true]){
      const a=ri?trails[i][0]:trails[i].at(-1),b=rj?trails[j].at(-1):trails[j][0],d=Math.hypot(a[0]-b[0],a[1]-b[1]);
      if(d<=joinWithinMM&&covered(a,b)&&(!best||d<best.d))best={i,j,ri,rj,d};
    }
    if(!best)break;const {i,j,ri,rj}=best;
    const a=ri?[...trails[i]].reverse():trails[i],b=rj?[...trails[j]].reverse():trails[j];
    trails[i]=[...a,...(key(a.at(-1))===key(b[0])?b.slice(1):b)];trails.splice(j,1);
  }
  const result=[];let at=[0,0];
  while(trails.length){let best=0,reverse=false,d=Infinity;
    trails.forEach((p,i)=>{for(const [v,rev] of [[p[0],false],[p.at(-1),true]]){const x=Math.hypot(v[0]-at[0],v[1]-at[1]);if(x<d){d=x;best=i;reverse=rev;}}});
    const p=trails.splice(best,1)[0];if(reverse)p.reverse();result.push(p);at=p.at(-1);
  }
  return result;
}
export const routeLines=routes=>routes.flatMap(p=>p.slice(1).map((b,i)=>[...p[i],...b]));
