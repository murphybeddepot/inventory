// Complete native XML identity. This is a synchronous export safety check,
// not authentication. Whitespace between elements and attribute order are
// irrelevant; every attribute value, element, text value and child order remain.
// No operation, band, assembly frame, Manual identity or layer is omitted.
// Comments are rejected: downstream tools can interpret embedded frame/safety
// metadata. None exists in the verified sources; adding even a cosmetic comment
// requires a newly reviewed exact-source scope instead of being normalized away.
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
export function sha256Text(text){
  const input=new TextEncoder().encode(String(text)),length=Math.ceil((input.length+9)/64)*64,
    bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
  bytes.set(input);bytes[input.length]=128;
  view.setUint32(length-8,Math.floor(input.length/0x20000000));view.setUint32(length-4,(input.length*8)>>>0);
  const state=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),r=(n,b)=>(n>>>b)|(n<<(32-b));
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=((r(a,7)^r(a,18)^(a>>>3))+w[i-16]+(r(b,17)^r(b,19)^(b>>>10))+w[i-7])>>>0;}
    let[a,b,c,d,e,f,g,h]=state;
    for(let i=0;i<64;i++){const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    for(const[i,v]of[a,b,c,d,e,f,g,h].entries())state[i]=(state[i]+v)>>>0;
  }
  return state.map(n=>n.toString(16).padStart(8,'0')).join('');
}
const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,s)=>s[0]==='#'?String.fromCodePoint(s[1].toLowerCase()==='x'?parseInt(s.slice(2),16):parseInt(s.slice(1),10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[s.toLowerCase()]);
export function rejectNativeXmlComments(text){if(String(text).includes('<!--'))throw Error('Native XML comments are outside the verified source scope; preserve frame metadata explicitly and re-review the source.');}
export function canonicalNativeXml(text){
  rejectNativeXmlComments(text);
  const input=String(text).slice(String(text).indexOf('<')),roots=[],stack=[];
  for(let at=0;at<input.length;){
    if(input[at]!=='<'){const next=input.indexOf('<',at),end=next<0?input.length:next,t=decode(input.slice(at,end)).trim();if(t){if(!stack.length)throw Error('Native XML text outside root.');stack.at(-1)[2].push(['#text',t]);}at=end;continue;}
    let end=at+1,quote='';for(;end<input.length;end++){const c=input[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===input.length)throw Error('Unclosed native XML tag.');const tag=input.slice(at+1,end).trim();at=end+1;
    if(tag.startsWith('?'))continue;
    if(tag.startsWith('!'))throw Error('Unsupported native XML declaration.');
    if(tag[0]==='/'){if(stack.pop()?.[0]!==tag.slice(1).trim())throw Error('Native XML closing tag mismatch.');continue;}
    const match=tag.match(/^([^\s/]+)([\s\S]*)$/);if(!match)throw Error('Invalid native XML element.');
    const tail=match[2].replace(/\/\s*$/,''),attrs=[],re=/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;let cursor=0,m;
    while((m=re.exec(tail))){if(tail.slice(cursor,m.index).trim())throw Error('Invalid native XML attributes.');attrs.push([m[1],decode(m[2]??m[3])]);cursor=re.lastIndex;}
    if(tail.slice(cursor).trim())throw Error('Invalid native XML attribute tail.');
    attrs.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);if(new Set(attrs.map(a=>a[0])).size!==attrs.length)throw Error('Duplicate native XML attribute.');
    const node=[match[1],attrs,[]];if(stack.length)stack.at(-1)[2].push(node);else roots.push(node);
    if(!/\/\s*$/.test(tag))stack.push(node);
  }
  if(stack.length||roots.length!==1)throw Error('Native XML must have one complete root.');
  return JSON.stringify(roots[0]);
}
export const nativeXmlFingerprint=raw=>sha256Text(canonicalNativeXml(raw));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
// Bought leaf sources travel with the packing view, never with router parts.
// A job that declares this scope must retain the complete records, including
// all physical operations and source frames. Missing metadata is not a match.
export function nativePackingSourcesFingerprint(nest){
  const sources=nest?.packingOnlyPurchasedSources;
  if(sources===undefined)return null;
  if(!Array.isArray(sources)||!sources.length)throw Error('Verified bought packing sources are missing.');
  return sha256Text(JSON.stringify(stable(sources.map(p=>{
    if(!p||p.purchased!==true||p.routerCut!==false||!p.report||!p.raw||!p.shell)throw Error('Incomplete bought packing source.');
    return {...p,raw:nativeXmlFingerprint(p.raw),shell:nativeXmlFingerprint(p.shell)};
  }))));
}
export function nativeSnapshotScope(snapshot){
  return{
    nativeSourceIdsSha256:sha256Text(JSON.stringify((snapshot.importedParts||[]).map(p=>[Number(p._nativePartNumber),nativeXmlFingerprint(p.raw)]).sort((a,b)=>a[0]-b[0]))),
    rawPartsSha256:sha256Text(JSON.stringify((snapshot.importedParts||[]).map(p=>nativeXmlFingerprint(p.raw)).sort())),
    importRecordsSha256:sha256Text(JSON.stringify((snapshot.importedParts||[]).map(p=>stable({...p,raw:nativeXmlFingerprint(p.raw)})).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1))),
    manifestSha256:sha256Text(JSON.stringify(stable(snapshot.manifest||[]))),
    layerMembershipSha256:sha256Text(JSON.stringify((snapshot.layers||[]).map(row=>row.map(p=>[p.key,p.secIdx,p.drillFrameCW??null]).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1)))),
    drillFramePolicySha256:sha256Text(JSON.stringify(stable(snapshot.drillFramePolicy??null))),
    sourceShellsSha256:sha256Text(JSON.stringify(Object.entries(snapshot.sourceShells||{}).map(([file,raw])=>[file,nativeXmlFingerprint(raw)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0))),
    sourceShellSha256:nativeXmlFingerprint(snapshot.sourceShell||''),
  };
}
