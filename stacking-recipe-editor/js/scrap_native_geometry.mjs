import {geometryOnSheet} from './nest_geometry.mjs?v=4.67';

const EPS=.003;
const near=(a,b)=>Math.abs(a-b)<=EPS;
const area=ps=>ps.reduce((n,p,i)=>{const q=ps[(i+1)%ps.length];return n+p[0]*q[1]-p[1]*q[0]},0);
export function offsetOutline(points,r){
  if(!Array.isArray(points)||points.length<4||!points.flat().every(Number.isFinite))throw Error('Missing native outline');
  const winding=Math.sign(area(points));if(!winding)throw Error('Degenerate native outline');
  const edges=points.map((p,i)=>{const q=points[(i+1)%points.length],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);
    if(len<=EPS||(!near(dx,0)&&!near(dy,0)))throw Error('Curved or diagonal native contours need a supported post model');
    const k=winding*r/len;return[p[0]+dy*k,p[1]-dx*k,q[0]+dy*k,q[1]-dx*k]});
  const vertices=edges.map((b,i)=>{const a=edges[(i+edges.length-1)%edges.length],av=near(a[0],a[2]),bv=near(b[0],b[2]);
    if(av===bv)throw Error('Redundant native outline vertices');return av?[a[0],b[1]]:[b[0],a[1]]});
  return vertices.map((p,i)=>[...p,...vertices[(i+1)%vertices.length]]);
}
// A straight native offset contour leaves a rounded inside corner at a base
// notch. Include that material in both collision checks and waste detection.
export function finishedOutline(points,r){
  const winding=Math.sign(area(points)),out=[];
  for(let i=0;i<points.length;i++){
    const p=points[i],a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length];
    const u=[p[0]-a[0],p[1]-a[1]],v=[b[0]-p[0],b[1]-p[1]],ul=Math.hypot(...u),vl=Math.hypot(...v);
    if((u[0]*v[1]-u[1]*v[0])*winding>=0){out.push(p);continue}
    const A=[p[0]-r*u[0]/ul,p[1]-r*u[1]/ul],q=[A[0]+r*v[0]/vl,A[1]+r*v[1]/vl];
    const start=Math.atan2(A[1]-q[1],A[0]-q[0]);
    // Chords conservatively include the tiny arc fringe; 64 segments per
    // quarter-circle match the posted geometry audit's resolution.
    for(let j=0;j<=64;j++){const t=start-winding*Math.PI/2*j/64;out.push([q[0]+r*Math.cos(t),q[1]+r*Math.sin(t)])}
  }
  return out;
}
export function pointInOutline([x,y],points){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function pointSegmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)}
function segmentsCross(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);
  return x*y<0&&u*v<0;
}
export function segmentOutlineDistance(line,points){
  const a=line.slice(0,2),b=line.slice(2);
  if(pointInOutline(a,points)||pointInOutline(b,points))return 0;
  let distance=Infinity;
  for(let i=0;i<points.length;i++){
    const c=points[i],d=points[(i+1)%points.length];if(segmentsCross(a,b,c,d))return 0;
    distance=Math.min(distance,pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
  }
  return distance;
}
export function modelNativePlacement(p,r,fallback){
  const geometry=geometryOnSheet(p,p.geometry);
  if(geometry.error)return {...fallback,geometryWarning:`${p.name}: ${geometry.error}; waste is a rectangle estimate, not verified native geometry.`};
  try{
    const contour=offsetOutline(geometry.points,r);
    return {...fallback,outline:finishedOutline(geometry.points,r),nativeOutline:geometry.points,contour,reference:geometry.reference};
  }catch(error){
    // Retain a conservative keepout for legitimate native shapes that this
    // orthogonal offset model cannot yet represent. Never crash the editor or
    // describe the bounding rectangle as a verified native cutter envelope.
    return {...fallback,reference:geometry.reference,geometryWarning:`${p.name}: ${error.message}; waste is a conservative rectangle estimate, not verified native geometry.`};
  }
}
