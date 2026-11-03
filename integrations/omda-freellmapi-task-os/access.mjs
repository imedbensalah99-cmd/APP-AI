// OMDA FreeLLMAPI Agents: fail-closed Cloudflare Access JWT verification.
// Runs on WebCrypto, no npm packages, no secrets in the browser or source control.
// Cloudflare reference: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
const textEncoder = new TextEncoder();
const toBytes = value => textEncoder.encode(value);
const asHex = bytes => [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const goodString = (value, max=128) => typeof value === 'string' && value.length>0 && value.length<=max;

function decodeBase64Url(s) {
  if(!/^[A-Za-z0-9_-]+$/.test(s) || s.length>12000) throw Error('Invalid JWT encoding');
  const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));
  return Uint8Array.from(raw, ch=>ch.charCodeAt(0));
}
function decodeJSON(s) {
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decodeBase64Url(s)));
}
function accessConfig(env) {
  const origin=env?.OMDA_ACCESS_ISSUER, aud=env?.OMDA_ACCESS_AUD;
  const email=env?.OMDA_OWNER_EMAIL, allowedOrigin=env?.OMDA_ALLOWED_ORIGIN;
  if(env?.OMDA_API_ENABLED!=='true' || !goodString(origin,200) ||
    !goodString(aud,256) || !goodString(email,254) || !goodString(allowedOrigin,200))
    return null;
  let parsed, allowed;
  try { parsed=new URL(origin); allowed=new URL(allowedOrigin); } catch{return null;}
  if(parsed.protocol!=='https:' || !parsed.hostname.endsWith('.cloudflareaccess.com') ||
    parsed.hostname==='.cloudflareaccess.com' || parsed.pathname!=='/' ||
    parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
    origin !== parsed.origin || allowed.protocol!=='https:' ||
    allowed.origin!==allowedOrigin || allowed.username || allowed.password ||
    allowed.search || allowed.hash) return null;
  const normalized=email.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))return null;
  return {origin,aud,email:normalized,allowedOrigin};
}
function createAccessVerifier({getJwks=fetch, now=()=>Date.now()}={}) {
  let cached=null;
  return async (req,env) => {
    const config=accessConfig(env);
    if(!config)return {ok:false,status:503};
    const jwt=req.headers.get('cf-access-jwt-assertion');
    if(!goodString(jwt,8192))return {ok:false,status:401};
    const parts=jwt.split('.');
    if(parts.length!==3)return {ok:false,status:401};
    try{
      const header=decodeJSON(parts[0]), payload=decodeJSON(parts[1]);
      if(header.alg!=='RS256' || !goodString(header.kid,200) ||
        !payload || typeof payload !== 'object' || Array.isArray(payload))return {ok:false,status:401};
      const clock=Math.floor(now()/1000);
      if(payload.iss!==config.origin ||
        !(payload.aud===config.aud || (Array.isArray(payload.aud)&&payload.aud.includes(config.aud))) ||
        !Number.isInteger(payload.exp) || payload.exp<=clock ||
        (payload.nbf!==undefined && (!Number.isInteger(payload.nbf)||payload.nbf>clock+30)) ||
        (payload.iat!==undefined && (!Number.isInteger(payload.iat)||payload.iat>clock+30)) ||
        !goodString(payload.email,254) || payload.email.toLowerCase()!==config.email ||
        !goodString(payload.sub,120)) return {ok:false,status:401};
      if(env?.OMDA_OWNER_SUB && payload.sub!==env.OMDA_OWNER_SUB)return {ok:false,status:401};

      if(!cached || cached.origin!==config.origin || cached.until<now() ||
        !cached.keys.some(x=>x.kid===header.kid)){
        const url=config.origin+'/cdn-cgi/access/certs';
        const resp=await getJwks(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(2500)});
        if(!resp.ok) return {ok:false,status:503};
        const raw=await resp.text();
        if(raw.length>100000)return {ok:false,status:503};
        const parsed=JSON.parse(raw);
        if(!Array.isArray(parsed?.keys)||parsed.keys.length>30)return {ok:false,status:503};
        cached={origin:config.origin,until:now()+300000,keys:parsed.keys.filter(k=>k.kty==='RSA' && goodString(k.kid,200) && goodString(k.n,2000) && goodString(k.e,20))};
      }
      const jwk=cached.keys.find(k=>k.kid===header.kid && (!k.alg||k.alg==='RS256') && (!k.use||k.use==='sig'));
      if(!jwk)return {ok:false,status:401};
      const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
      const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodeBase64Url(parts[2]),toBytes(parts[0]+'.'+parts[1]));
      if(!valid)return {ok:false,status:401};
      const digest=await crypto.subtle.digest('SHA-256',toBytes(payload.sub));
      return {ok:true,owner:'access:'+asHex(new Uint8Array(digest)),config};
    }catch {
      // No raw exception is echoed to avoid disclosing tokens and crypto internals.
      return {ok:false,status:401};
    }
  };
}
export {accessConfig,createAccessVerifier};
