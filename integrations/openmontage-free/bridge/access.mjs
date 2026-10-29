/**
 * Verify the Access JWT injected by Cloudflare before allowing OMDA operations.
 * Trust ONLY the cryptographic signature and exact configured issuer/audience/email.
 * No reliance on ctx.access or untrusted caller-controlled identity headers alone.
 */
const MAX_JWT_BYTES=8192;
let keyCache=null;
let keyCacheTime=0;
function decode(segment){
  if(typeof segment!=='string'||!/^[A-Za-z0-9_-]+$/.test(segment))throw Error('JWT_FORMAT');
  const normalized=segment.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
function decodeJson(segment){
  return JSON.parse(new TextDecoder().decode(decode(segment)));
}
function fail(){return false}
function originIssuer(env){
  const issuer=env.OMDA_ACCESS_ISS;
  if(typeof issuer!=='string')return null;
  try{
    const u=new URL(issuer);
    if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password||
      !u.hostname.endsWith('.cloudflareaccess.com'))return null;
    return u.origin;
  }catch{return null}
}
async function getJwks(issuer){
  // Cache only a short time; never cache a failed fetch.
  if(keyCache&&keyCache.issuer===issuer&&Date.now()-keyCacheTime<300000)return keyCache.keys;
  const u=issuer+'/cdn-cgi/access/certs';
  const r=await fetch(u,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok||!(r.headers.get('content-type')||'').includes('json'))return [];
  const value=await r.json();
  if(!Array.isArray(value?.keys)||value.keys.length>25)return [];
  keyCache={issuer,keys:value.keys};
  keyCacheTime=Date.now();
  return value.keys;
}
export async function verifyAccessRequest(request,env){
  if(typeof env.OMDA_OWNER_EMAIL!=='string'||typeof env.OMDA_ACCESS_AUD!=='string')return false;
  const expectedEmail=env.OMDA_OWNER_EMAIL.trim().toLowerCase();
  const expectedAudience=env.OMDA_ACCESS_AUD.trim();
  const issuer=originIssuer(env);
  if(!issuer||!expectedEmail||!/^[a-f0-9]{64}$/.test(expectedAudience))return false;
  // Cloudflare Access may deliver a signed session JWT via CF_Authorization
  // cookie (not an assertion header) in Chrome Custom Tabs/mobile sessions.
  // Never trust cookie claims directly; both paths require identical RS256,
  // issuer, audience, expiry and owner-email verification below.
  const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
  let token=assertion;
  if(!token){
    const rawCookies=request.headers.get('Cookie')||'';
    if(rawCookies.length>16000)return false;
    const found=rawCookies.split(';').map(part=>part.trim())
      .filter(part=>part.startsWith('CF_Authorization='));
    if(found.length!==1)return false;
    const encoded=found[0].slice('CF_Authorization='.length);
    try{token=decodeURIComponent(encoded)}catch{return false}
  }
  if(!token||token.length>MAX_JWT_BYTES||token.split('.').length!==3)return false;
  try{
    const [a,b,c]=token.split('.');
    const header=decodeJson(a),claims=decodeJson(b);
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>150)return false;
    if(claims.iss!==issuer||!Array.isArray(claims.aud)||!claims.aud.includes(expectedAudience)||
       typeof claims.email!=='string'||claims.email.trim().toLowerCase()!==expectedEmail)return false;
    const now=Math.floor(Date.now()/1000);
    if(typeof claims.exp!=='number'||typeof claims.iat!=='number'||
       claims.exp<=now||claims.exp>now+86400||claims.iat>now+60||
       (claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now+60)))return false;
    const keys=await getJwks(issuer);
    const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&
      (k.alg===undefined||k.alg==='RS256')&&typeof k.n==='string'&&typeof k.e==='string');
    if(!jwk)return false;
    const key=await crypto.subtle.importKey('jwk',jwk,
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(c),
      new TextEncoder().encode(a+'.'+b));
  }catch{return fail()}
}


/**
 * Prefer Cloudflare's runtime-authenticated Worker context when present.
 * Cloudflare populates ctx.access only for an Access-authorized invocation.
 * Fall back to cryptographically verified app JWT when context isn't supplied.
 * Never accept user-supplied email headers or an unsigned browser cookie.
 */
export async function verifyOwnerAccess(request, env, ctx){
  const expected=typeof env.OMDA_OWNER_EMAIL==='string'?
    env.OMDA_OWNER_EMAIL.trim().toLowerCase():'';
  if(!expected)return false;
  if(ctx?.access){
    if(typeof ctx.access.getIdentity!=='function')return false;
    try{
      const identity=await ctx.access.getIdentity();
      return typeof identity?.email==='string' &&
        identity.email.trim().toLowerCase()===expected;
    }catch{return false}
  }
  return verifyAccessRequest(request,env);
}
