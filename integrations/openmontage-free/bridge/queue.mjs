/**
 * OMDA D1 job journal. Staging-only; no media files, tokens or full scripts stored.
 * Prepared statements keep all input out of SQL syntax. Every journal mutation
 * must be invoked only after the bridge has verified Cloudflare Access.
 */
const VALID_STATE=new Set(['DISPATCH_PENDING','QUEUED','FETCHING_ASSETS','RENDERING','ARCHIVING',
  'READY_FOR_OWNER_REVIEW','BLOCKED','FAILED','DISPATCH_BLOCKED','REMOTE_UNAVAILABLE','UNKNOWN']);
const stateOf=s=>VALID_STATE.has(s)?s:'UNKNOWN';
function store(db){
 if(!db||typeof db.prepare!=='function')throw Error('D1_NOT_BOUND');
 return db;
}
async function fingerprint(data){
 const canon=JSON.stringify(data);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
async function byKey(db,key){
 return db.prepare('SELECT job_id,request_key,fingerprint,title,country,duration_seconds,state,remote_job_id,error_code,created_at,updated_at FROM documentary_jobs WHERE request_key=?').bind(key).first();
}
export async function findJob(db,id){
 return store(db).prepare('SELECT job_id,request_key,title,country,duration_seconds,state,remote_job_id,error_code,created_at,updated_at FROM documentary_jobs WHERE job_id=?').bind(id).first();
}
export async function listJobs(db){
 const result=await store(db).prepare('SELECT job_id,title,country,duration_seconds,state,remote_job_id,error_code,created_at,updated_at FROM documentary_jobs ORDER BY created_at DESC LIMIT 30').all();
 return result.results||[];
}
export async function claimJob(db,data){
 db=store(db);
 const hash=await fingerprint(data);
 const existing=await byKey(db,data.idempotency_key);
 if(existing){
   if(existing.fingerprint!==hash)throw Error('IDEMPOTENCY_CONFLICT');
   return {new:false,job:existing};
 }
 const existingId=await findJob(db,data.job_id);
 if(existingId)throw Error('JOB_ID_CONFLICT');
 const at=new Date().toISOString();
 await db.prepare('INSERT OR IGNORE INTO documentary_jobs (job_id,request_key,fingerprint,title,country,duration_seconds,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
   .bind(data.job_id,data.idempotency_key,hash,data.title,data.country,data.duration_seconds,
     'DISPATCH_PENDING',at,at).run();
 const row=await byKey(db,data.idempotency_key);
 if(!row)throw Error('D1_INSERT_FAILED');
 if(row.fingerprint!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 if(row.job_id!==data.job_id)throw Error('JOB_ID_CONFLICT');
 return {new:row.created_at===at,job:row};
}
export async function updateJob(db,id,state,remoteId=null,errorCode=null){
 if(!VALID_STATE.has(state))throw Error('STATE_INVALID');
 if(remoteId!==null&&!/^[A-Za-z0-9_-]{6,100}$/.test(remoteId))throw Error('REMOTE_JOB_ID_INVALID');
 if(errorCode!==null&&(!/^[A-Z0-9_]{3,70}$/.test(errorCode)))errorCode='UPSTREAM_FAILURE';
 const result=await store(db).prepare('UPDATE documentary_jobs SET state=?,remote_job_id=COALESCE(?,remote_job_id),error_code=?,updated_at=? WHERE job_id=?')
   .bind(state,remoteId,errorCode,new Date().toISOString(),id).run();
 return result.meta?.changes===1;
}
export function normalizeState(status){return stateOf(status)}
