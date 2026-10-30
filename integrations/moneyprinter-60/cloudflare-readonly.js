/* OMDA MoneyPrinter 60 — read-only Cloudflare staging probe.
   No write/job routes, no secrets, no publishing. Do not enable production here. */
const BACKEND = "https://omda-moneyprinter-60-staging.onrender.com/health";
addEventListener("fetch", event => event.respondWith(handle(event.request)));

async function handle(request) {
  const url = new URL(request.url);
  const headers = {"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"};
  if (request.method !== "GET" || url.pathname !== "/health") {
    return new Response(JSON.stringify({error:"READ_ONLY_BRIDGE"}), {status:404,headers});
  }
  try {
    const response = await fetch(BACKEND, {method:"GET", redirect:"manual",
      headers:{"Accept":"application/json"}, cf:{cacheTtl:0, cacheEverything:false}});
    if (response.status !== 200) {
      return new Response(JSON.stringify({status:"BACKEND_UNAVAILABLE"}),
        {status:503,headers});
    }
    const status = await response.json();
    return new Response(JSON.stringify({
      status:status.status==="AVAILABLE"?"AVAILABLE":"BACKEND_UNAVAILABLE",
      integration:"MoneyPrinterTurbo staging",
      duration_seconds:60,
      generation_enabled:false,
      publishing:false,
      paid_generation:false,
      upstream_configured:status.upstream_configured===true,
      safe_readonly:true
    }), {status:200,headers});
  } catch {
    return new Response(JSON.stringify({status:"BACKEND_UNAVAILABLE"}),
      {status:503,headers});
  }
}
