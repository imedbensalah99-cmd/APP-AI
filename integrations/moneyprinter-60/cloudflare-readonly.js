/* OMDA isolated read-only status. Public GitHub proof metadata only.
 * No provider secrets, user scripts, job submission, uploads, or publishing.
 */
const RENDER = "https://omda-moneyprinter-60-staging.onrender.com/health";
const GITHUB = "https://api.github.com/repos/imedbensalah99-cmd/APP-AI/actions/workflows/omda-moneyprinter60-cloud-proof.yml/runs?branch=omda-moneyprinter-60-staging-v1&per_page=1";
const HEADERS = {
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff"
};
addEventListener("fetch", event => event.respondWith(handle(event.request)));

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: HEADERS});
}

async function handle(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" ||
      (url.pathname !== "/health" && url.pathname !== "/v1/proof")) {
    return json({error:"READ_ONLY_BRIDGE"}, 404);
  }
  if (url.pathname === "/health") {
    try {
      const response = await fetch(RENDER, {
        method:"GET", redirect:"manual",
        cf:{cacheTtl:0, cacheEverything:false}
      });
      if (response.status !== 200) return json({status:"BACKEND_UNAVAILABLE"},503);
      const data = await response.json();
      return json({
        status:data.status === "AVAILABLE" ? "AVAILABLE" : "BACKEND_UNAVAILABLE",
        integration:"MoneyPrinterTurbo 60s staging",
        duration_seconds:60, generation_enabled:false, publishing:false,
        paid_generation:false, upstream_configured:data.upstream_configured === true,
        safe_readonly:true, proof_endpoint:"/v1/proof"
      });
    } catch { return json({status:"BACKEND_UNAVAILABLE"},503); }
  }
  try {
    const response = await fetch(GITHUB,{
      method:"GET",redirect:"manual",
      headers:{"User-Agent":"OMDA-Staging-ReadOnly-Probe",
               "Accept":"application/vnd.github+json",
               "X-GitHub-Api-Version":"2022-11-28"},
      cf:{cacheTtl:45,cacheEverything:true}
    });
    if (response.status !== 200) return json({status:"PROOF_UNAVAILABLE"},503);
    const data = await response.json();
    const run = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : undefined;
    if (!run || typeof run.id !== "number" ||
        typeof run.html_url !== "string" ||
        !run.html_url.startsWith("https://github.com/imedbensalah99-cmd/APP-AI/actions/runs/")) {
      return json({status:"NO_PROOF_RUN",published:false});
    }
    const valid = ["queued","in_progress","completed","waiting","requested","pending"];
    if (!valid.includes(run.status)) return json({status:"PROOF_INVALID"},502);
    return json({
      status:run.status, conclusion:run.conclusion || null,
      run_id:run.id, run_url:run.html_url,
      head_sha:run.head_sha,
      source:"GitHub Actions API, real upstream MoneyPrinterTurbo CLI",
      duration_target_seconds:60,
      artifact_verified:false,
      publishing:false, paid_generation:false, safe_readonly:true
    });
  } catch { return json({status:"PROOF_UNAVAILABLE"},503); }
}
