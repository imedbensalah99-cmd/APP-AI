import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {sealTaskBackup,restoreTaskBackup,SCHEMA,TABLES,SCHEMA_SHA} from './recovery.mjs';
const key=()=>randomBytes(32);
const HASH='a'.repeat(64);
function db(){
  const d=new DatabaseSync(':memory:');
  d.exec(SCHEMA);
  return d;
}
function task(d,id,owner,idem){
  d.prepare('INSERT INTO omda_task_tasks '+
    '(task_id,owner_scope,idempotency_key,request_digest_sha256,original_command,'+
    'intent_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,owner,idem,HASH,'Build a private spreadsheet','["spreadsheet"]','PLANNED',
      '2026-11-03T10:00Z','2026-11-03T10:00Z');
}
function seeded(){
  const d=db();
  d.prepare('INSERT INTO omda_task_schema_versions(version,applied_at) VALUES(?,?)')
    .run(1,'2026-11-03T10:00Z');
  task(d,'task-a','owner-alpha-01','owner-alpha-key-01');
  task(d,'task-b','owner-beta-0002','owner-beta-key-02');
  d.prepare('INSERT INTO omda_task_steps '+
    '(step_id,task_id,owner_scope,kind,input_json,status,created_at,updated_at) '+
    'VALUES (?,?,?,?,?,?,?,?)')
    .run('step-a','task-a','owner-alpha-01','spreadsheet','{}','PLANNED','2026-11-03T10:00Z','2026-11-03T10:00Z');
  d.prepare('INSERT INTO omda_task_approvals '+
    '(approval_id,task_id,owner_scope,operation,target,payload_digest_sha256,payload_version,status,'+
    'issued_at,expires_at,audit_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('approval-a','task-a','owner-alpha-01','email.send','alice@example.invalid',HASH,
      1,'WAITING_FOR_APPROVAL','2026-11-03T10:00Z','2026-11-05T10:00Z','audit-1');
  d.prepare('INSERT INTO omda_task_audit '+
    '(event_id,owner_scope,task_id,event_type,context_redacted_json,recorded_at)'+
    ' VALUES (?,?,?,?,?,?)')
    .run('audit-1','owner-alpha-01','task-a','task.created','{}','2026-11-03T10:00Z');
  d.exec("CREATE TABLE agent_checks (id INTEGER PRIMARY KEY, note TEXT NOT NULL);");
  d.prepare('INSERT INTO agent_checks(note) VALUES (?)').run('existing readiness data: never export');
  return d;
}
test('AES-256-GCM encrypted backup excludes existing agent readiness and project data',()=>{
  const source=seeded(),secret=key();
  const sealed=sealTaskBackup(source,secret);
  const raw=sealed.toString('utf8');
  assert.ok(raw.includes('AES-256-GCM'));
  assert.ok(!raw.includes('Build a private spreadsheet'));
  assert.ok(!raw.includes('existing readiness data'));
  assert.ok(!raw.includes('alice@example.invalid'));
  const doc=JSON.parse(raw);
  assert.equal(doc.format,'omda-freellmapi-task-snapshot-v1');
  assert.equal(doc.schemaSha256,SCHEMA_SHA);
  assert.equal(TABLES.length,10);
  assert.equal(source.prepare('SELECT note FROM agent_checks').get().note,
    'existing readiness data: never export');
  source.close();
});
test('restore encrypted snapshot to genuinely fresh SQLite with owners and FKs preserved',()=>{
  const source=seeded(),target=db(),secret=key();
  const archive=sealTaskBackup(source,secret);
  const out=restoreTaskBackup(target,archive,secret);
  assert.deepEqual(out,{tables:10,rows:6,integrity:'PASS',encrypted:true});
  assert.equal(target.prepare('SELECT count(*) n FROM omda_task_tasks').get().n,2);
  assert.equal(target.prepare('SELECT count(*) n FROM omda_task_steps').get().n,1);
  assert.equal(target.prepare('SELECT owner_scope FROM omda_task_approvals').get().owner_scope,
    'owner-alpha-01');
  assert.deepEqual(target.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(target.prepare("SELECT count(*) n FROM sqlite_master WHERE name='agent_checks'").get().n,0);
  source.close();target.close();
});
test('wrong key, missing key, short key and corrupted ciphertext do not mutate target',()=>{
  const source=seeded(),target=db(),secret=key(),sealed=sealTaskBackup(source,secret);
  assert.throws(()=>restoreTaskBackup(target,sealed,key()),/validation failed/);
  assert.throws(()=>restoreTaskBackup(target,sealed,null),/32-byte/);
  assert.throws(()=>restoreTaskBackup(target,sealed,randomBytes(16)),/32-byte/);
  const bad=JSON.parse(sealed.toString('utf8'));
  bad.ciphertext=bad.ciphertext.replace(/^./,bad.ciphertext[0]==='A'?'B':'A');
  assert.throws(()=>restoreTaskBackup(target,Buffer.from(JSON.stringify(bad)),secret),/validation failed/);
  assert.equal(target.prepare('SELECT count(*) n FROM omda_task_tasks').get().n,0);
  source.close();target.close();
});
test('authenticated backup cannot replay into database containing existing tasks',()=>{
  const source=seeded(),target=db(),secret=key();
  task(target,'existing','owner-alpha-01','existing-idem-01');
  const archive=sealTaskBackup(source,secret);
  assert.throws(()=>restoreTaskBackup(target,archive,secret),/not empty/);
  assert.equal(target.prepare('SELECT task_id FROM omda_task_tasks').get().task_id,'existing');
  source.close();target.close();
});
test('restore refuses existing unrelated readiness or another OMDA project table',()=>{
  const source=seeded(),target=db(),secret=key();
  target.exec('CREATE TABLE agent_checks(id INTEGER PRIMARY KEY);');
  const archive=sealTaskBackup(source,secret);
  assert.throws(()=>restoreTaskBackup(target,archive,secret),/non-Task OS tables/);
  source.close();target.close();
});
test('source missing canonical Task OS table cannot be archived',()=>{
  const d=new DatabaseSync(':memory:');
  d.exec("CREATE TABLE agent_checks(id INTEGER);");
  assert.throws(()=>sealTaskBackup(d,key()),/validation failed/);
  d.close();
});
test('key rotation creates independently encrypted backups and old key never works',()=>{
  const source=seeded(),target=db(),oldKey=key(),newKey=key();
  const old=sealTaskBackup(source,oldKey),fresh=sealTaskBackup(source,newKey);
  assert.notEqual(old.toString('hex'),fresh.toString('hex'));
  assert.throws(()=>restoreTaskBackup(target,fresh,oldKey),/validation failed/);
  assert.equal(restoreTaskBackup(target,fresh,newKey).integrity,'PASS');
  source.close();target.close();
});
test('two snapshots on the same key have unique random nonces and ciphertext',()=>{
  const source=seeded(),secret=key();
  const a=JSON.parse(sealTaskBackup(source,secret).toString('utf8'));
  const b=JSON.parse(sealTaskBackup(source,secret).toString('utf8'));
  assert.notEqual(a.nonce,b.nonce);
  assert.notEqual(a.ciphertext,b.ciphertext);
  source.close();
});
test('source is unchanged after encrypted snapshot',()=>{
  const source=seeded(),secret=key();
  const before=source.prepare('SELECT count(*) n FROM omda_task_tasks').get().n;
  const beforeSchema=source.prepare('SELECT count(*) n FROM sqlite_master').get().n;
  sealTaskBackup(source,secret);
  assert.equal(source.prepare('SELECT count(*) n FROM omda_task_tasks').get().n,before);
  assert.equal(source.prepare('SELECT count(*) n FROM sqlite_master').get().n,beforeSchema);
  assert.equal(source.prepare('SELECT note FROM agent_checks').get().note,
    'existing readiness data: never export');
  source.close();
});
test('schema migration rehearsal preserves preexisting readiness tables and rows',()=>{
  const d=new DatabaseSync(':memory:');
  d.exec("CREATE TABLE agent_checks(id INTEGER PRIMARY KEY, text TEXT);"+
    "CREATE TABLE agent_quotas(id INTEGER PRIMARY KEY, remaining INTEGER);");
  d.exec("INSERT INTO agent_checks(text) VALUES ('untouched');"+
    "INSERT INTO agent_quotas(remaining) VALUES(10);");
  const before=JSON.stringify(d.prepare("SELECT * FROM agent_checks").all())+
    JSON.stringify(d.prepare("SELECT * FROM agent_quotas").all());
  d.exec(SCHEMA);d.exec(SCHEMA); // idempotent candidate, never touches originals.
  const after=JSON.stringify(d.prepare("SELECT * FROM agent_checks").all())+
    JSON.stringify(d.prepare("SELECT * FROM agent_quotas").all());
  assert.equal(before,after);
  assert.equal(d.prepare("SELECT count(*) n FROM omda_task_tasks").get().n,0);
  d.close();
});
test('invalid or truncated sealed archive does not create records',()=>{
  const source=seeded(),target=db(),secret=key();
  const archive=sealTaskBackup(source,secret);
  for(const bad of [Buffer.from(''),archive.subarray(0,30),Buffer.alloc(7*1024*1024)]){
    assert.throws(()=>restoreTaskBackup(target,bad,secret),/validation failed/);
  }
  assert.equal(target.prepare('SELECT count(*) n FROM omda_task_tasks').get().n,0);
  source.close();target.close();
});
