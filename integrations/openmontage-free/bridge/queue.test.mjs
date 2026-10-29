import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {claimJob,findJob,listJobs,normalizeState,updateJob} from './queue.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

class FakeD1{
  constructor(){this.rows=new Map()}
  prepare(sql){
    return {bind:(...v)=>({
      first:async()=>this.first(sql,v),
      all:async()=>this.all(sql,v),
      run:async()=>this.run(sql,v)
    })}
  }
  first(sql,v){
    if(sql.includes('WHERE request_key=?')) return [...this.rows.values()].find(x=>x.request_key===v[0])||null;
    if(sql.includes('WHERE job_id=?'))return this.rows.get(v[0])||null;
    throw Error('Unexpected D1 read: '+sql);
  }
  all(sql,v){if(sql.includes('ORDER BY created_at DESC LIMIT 30'))return {results:[...this.rows.values()].slice(-30).reverse().map(x=>({...x}))};throw Error('Unexpected D1 all')}
  run(sql,v){
    if(sql.startsWith('INSERT OR IGNORE')){
      if(this.rows.has(v[0])||[...this.rows.values()].some(x=>x.request_key===v[1]))return{meta:{changes:0}};
      this.rows.set(v[0],{job_id:v[0],request_key:v[1],fingerprint:v[2],title:v[3],country:v[4],duration_seconds:v[5],state:v[6],created_at:v[7],updated_at:v[8],remote_job_id:null,error_code:null});
      return{meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE documentary_jobs')){
      const row=this.rows.get(v[4]);if(!row)return {meta:{changes:0}};
      row.state=v[0];row.remote_job_id=v[1]??row.remote_job_id;row.error_code=v[2];row.updated_at=v[3];return{meta:{changes:1}};
    }
    throw Error('Unexpected write: '+sql);
  }
}
function sample(){return {job_id:'germanypilot0001',idempotency_key:'germanykey2026',title:'Germany',
country:'Germany',duration_seconds:120,provider_policy:'FREE_ONLY',publish_intent:false}}
test('new job has durable D1 receipt',async()=>{
 const db=new FakeD1(),p=sample(),x=await claimJob(db,p);
 assert.equal(x.new,true);assert.equal(x.job.state,'DISPATCH_PENDING');
 assert.equal((await findJob(db,p.job_id)).job_id,p.job_id);
 assert.equal((await listJobs(db)).length,1);
});
test('duplicate idempotency does not requeue',async()=>{
 const db=new FakeD1(),p=sample();await claimJob(db,p);const again=await claimJob(db,p);
 assert.equal(again.new,false);assert.equal(db.rows.size,1);
});
test('conflicting payload and duplicate ID denied',async()=>{
 const db=new FakeD1(),p=sample();await claimJob(db,p);
 await assert.rejects(()=>claimJob(db,{...p,title:'Altered'}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>claimJob(db,{...p,idempotency_key:'differentkey2026'}),/JOB_ID_CONFLICT/);
});
test('state update with bounded error and remote ID',async()=>{
 const db=new FakeD1(),p=sample();await claimJob(db,p);
 assert.equal(await updateJob(db,p.job_id,'QUEUED','germanypilot0001'),true);
 assert.equal((await findJob(db,p.job_id)).remote_job_id,p.job_id);
 assert.equal(await updateJob(db,p.job_id,'DISPATCH_BLOCKED',null,'RENDER_HTTP_503'),true);
 assert.equal((await findJob(db,p.job_id)).error_code,'RENDER_HTTP_503');
 assert.equal(await updateJob(db,'notfound','FAILED'),false);
 assert.equal(normalizeState('arbitrary'),'UNKNOWN');
 await assert.rejects(()=>updateJob(db,p.job_id,'APPROVED'),/STATE_INVALID/);
});
