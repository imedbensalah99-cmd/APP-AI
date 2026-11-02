const ORIGIN='https://omda-freellmapi-secure-staging-v1.onrender.com';
const TRANSIENT=new Set([502,503,504]);
const VERSION='coldstart-v3';
export default {async fetch(request,env){
  if(!env.OMDA_ORIGIN_TOKEN||env.OMDA_ORIGIN_TOKEN.length<48)
    return new Response('Gateway unavailable',{status:503,headers:{'Cache-Control':'no-store'}});
  const incoming=new URL(request.url);
  // Setting pathname/search separately prevents network-path URL injection.
  const target=new URL(ORIGIN);
  target.pathname=incoming.pathname;
  target.search=incoming.search;
  if(target.origin!==ORIGIN)return new Response('Invalid origin',{status:400});
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(request.method))
    return new Response('Method not allowed',{status:405});
  const headers=new Headers(request.headers);
  for(const h of ['host','cookie','cf-access-jwt-assertion','cf-access-client-id','cf-access-client-secret','x-omda-origin-token','x-forwarded-for','x-real-ip','forwarded','proxy-authorization'])headers.delete(h);
  headers.set('x-omda-origin-token',env.OMDA_ORIGIN_TOKEN);
  headers.set('x-forwarded-proto','https');
  const readOnly=request.method==='GET'||request.method==='HEAD';
  const navigation=request.method==='GET'&&(incoming.pathname==='/'||(request.headers.get('accept')||'').includes('text/html'));
  // Never replay POST or writes, including AI requests.
  async function forward(){return fetch(new Request(target.toString(),{
    method:request.method,headers,body:readOnly?undefined:request.body,duplex:readOnly?undefined:'half',redirect:'manual'
  }));}
  async function wakeOrigin(){
    const deadline=Date.now()+65000;
    for(let round=0;round<8&&Date.now()<deadline;round++){
      try{
        const remaining=deadline-Date.now();
        const live=await fetch(ORIGIN+'/api/ping',{
          method:'GET',headers:{'x-omda-origin-token':env.OMDA_ORIGIN_TOKEN},
          redirect:'manual',signal:AbortSignal.timeout(Math.max(1000,Math.min(45000,remaining)))
        });
        const ready=live.status===200;
        try{await live.body?.cancel();}catch{}
        if(ready)return true;
      }catch{}
      const remaining=deadline-Date.now();
      if(round<7&&remaining>0)await new Promise(r=>setTimeout(r,Math.min(3000,remaining)));
    }
    return false;
  }
  // Pre-warm Render before HTML navigation to avoid returning a branded 502
  // while its free instance is starting (observed ~22 s cold start).
  if(navigation&&!(await wakeOrigin())){
    return new Response('FreeLLMAPI is starting. Please retry shortly.',{
      status:503,headers:{'Cache-Control':'no-store','Retry-After':'10','X-OMDA-Gateway':VERSION}
    });
  }
  let response;
  try{response=await forward();}
  catch{
    if(!readOnly)return new Response('Origin temporarily unavailable',{
      status:502,headers:{'Cache-Control':'no-store','X-OMDA-Gateway':VERSION}
    });
  }
  if(readOnly&&(!response||TRANSIENT.has(response.status))){
    try{await response?.body?.cancel();}catch{}
    if(await wakeOrigin()){
      try{response=await forward();}
      catch{response=undefined;}
    }else response=undefined;
  }
  if(!response||TRANSIENT.has(response.status)){
    return new Response('FreeLLMAPI is temporarily unavailable. Please retry.',{
      status:503,headers:{'Cache-Control':'no-store','Retry-After':'10','X-OMDA-Gateway':VERSION}
    });
  }
  const resultHeaders=new Headers(response.headers);
  const location=resultHeaders.get('location');
  if(location&&location.startsWith(ORIGIN))resultHeaders.set('location',location.replace(ORIGIN,incoming.origin));
  resultHeaders.set('cache-control','no-store');
  resultHeaders.set('x-content-type-options','nosniff');
  resultHeaders.set('x-omda-gateway',VERSION);
  return new Response(response.body,{status:response.status,headers:resultHeaders});
}};
