// OMDA FreeLLMAPI Agents — isolated encrypted Task OS snapshot.
// Real SQLite/Node24 only. This utility does NOT call Cloudflare or migrate live D1.
// Requires a fresh 32-byte key supplied by secret manager, never a committed key.
// Restore ALWAYS into a disposable, empty schema-matched database, never an existing one.
import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const FORMAT='omda-freellmapi-task-snapshot-v1';
const AAD=Buffer.from('OMDA FreeLLMAPI Agents Task OS | encrypted isolated backup | v1','utf8');
const SCHEMA=readFileSync(fileURLToPath(new URL('./schema.sql',import.meta.url)),'utf8');
const SCHEMA_SHA=createHash('sha256').update(SCHEMA).digest('hex');
const MAX_PLAIN_BYTES=4*1024*1024;
const MAX_SEALED_BYTES=6*1024*1024;
const TABLES=Object.freeze([
  'omda_task_schema_versions',
  'omda_task_sessions',
  'omda_task_tasks',
  'omda_task_steps',
  'omda_task_dependencies',
  'omda_task_approvals',
  'omda_task_external_actions',
  'omda_task_artifacts',
  'omda_task_audit'
]);
const INVALID=()=>new Error('Task backup validation failed');
function assertKey(key){
  if(!(key instanceof Uint8Array)||key.byteLength!==32)throw new Error('Task backup requires a 32-byte encryption key');
  return Buffer.from(key);
}
function tablesIn(db){
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
}
function assertSchema(db){
  const names=tablesIn(db);
  if(TABLES.some(t=>!names.has(t)))throw INVALID();
  // Exact local schema hash is embedded in the archive, no automatic migrations.
  for(const table of TABLES){
    const got=db.prepare('PRAGMA table_info('+table+')').all();
    if(!got.length)throw INVALID();
  }
}
function snapshot(db){
  assertSchema(db);
  // BEGIN read transaction gives a consistent snapshot under concurrent WAL writes.
  db.exec('BEGIN');
  try{
    const records={};
    for(const table of TABLES){
      const rows=db.prepare('SELECT * FROM '+table).all();
      // Task schema is TEXT / INTEGER only. Refuse binary, unknown special values.
      for(const row of rows) for(const value of Object.values(row))
        if(value!==null && typeof value!=='string' && !(typeof value==='number'&&Number.isSafeInteger(value)))
          throw INVALID();
      records[table]=rows;
    }
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    if(fk.length)throw INVALID();
    return records;
  }finally{db.exec('ROLLBACK');} // Read-only release, no writes performed.
}
function sealTaskBackup(db,key){
  const secret=assertKey(key);
  const records=snapshot(db);
  const clear=Buffer.from(JSON.stringify({format:FORMAT,project:'omda-freellmapi-agents',
    schemaSha256:SCHEMA_SHA,records}),'utf8');
  if(clear.length>MAX_PLAIN_BYTES)throw new Error('Backup exceeds private size ceiling');
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',secret,nonce);
  cipher.setAAD(AAD);
  const enc=Buffer.concat([cipher.update(clear),cipher.final()]);
  const envelope={format:FORMAT,algorithm:'AES-256-GCM',schemaSha256:SCHEMA_SHA,
    nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
    ciphertext:enc.toString('base64')};
  return Buffer.from(JSON.stringify(envelope),'utf8');
}
function decrypt(envelope,key){
  const secret=assertKey(key);
  if(!(envelope instanceof Uint8Array)||envelope.byteLength>MAX_SEALED_BYTES)
    throw INVALID();
  let obj;
  try{obj=JSON.parse(Buffer.from(envelope).toString('utf8'));}catch{throw INVALID();}
  if(!obj||Object.keys(obj).sort().join(',')!=='algorithm,ciphertext,format,nonce,schemaSha256,tag' ||
    obj.format!==FORMAT||obj.algorithm!=='AES-256-GCM'||obj.schemaSha256!==SCHEMA_SHA ||
    typeof obj.nonce!=='string'||typeof obj.tag!=='string'||typeof obj.ciphertext!=='string')
    throw INVALID();
  const nonce=Buffer.from(obj.nonce,'base64'),tag=Buffer.from(obj.tag,'base64');
  if(nonce.length!==12||tag.length!==16)throw INVALID();
  let plain;
  try{
    const dec=createDecipheriv('aes-256-gcm',secret,nonce);
    dec.setAAD(AAD);dec.setAuthTag(tag);
    plain=Buffer.concat([dec.update(Buffer.from(obj.ciphertext,'base64')),dec.final()]);
  }catch{throw INVALID();}
  if(plain.length>MAX_PLAIN_BYTES)throw INVALID();
  let doc;
  try{doc=JSON.parse(plain.toString('utf8'));}catch{throw INVALID();}
  if(doc?.format!==FORMAT||doc?.project!=='omda-freellmapi-agents'||doc.schemaSha256!==SCHEMA_SHA ||
    !doc.records||typeof doc.records!=='object'||Array.isArray(doc.records))throw INVALID();
  const keys=Object.keys(doc.records).sort();
  if(keys.length!==TABLES.length||!keys.every((k,i)=>k===[...TABLES].sort()[i]))throw INVALID();
  for(const table of TABLES)if(!Array.isArray(doc.records[table]))throw INVALID();
  return doc.records;
}
function restoreTaskBackup(db,envelope,key){
  // Authentication + envelope validation happens BEFORE any database operation.
  const records=decrypt(envelope,key);
  assertSchema(db);
  // An existing database is NOT a restore target: avoid mixed ownership/duplicates.
  const names=tablesIn(db);
  if([...names].some(x=>!TABLES.includes(x)&&!x.startsWith('sqlite_')))
    throw new Error('Restore target contains non-Task OS tables');
  for(const table of TABLES){
    if(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n!==0)
      throw new Error('Restore target is not empty');
  }
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('BEGIN IMMEDIATE');
  let restored=0;
  try{
    for(const table of TABLES){
      const columns=db.prepare('PRAGMA table_info('+table+')').all().map(x=>x.name);
      const names=new Set(columns);
      for(const row of records[table]){
        if(!row||typeof row!=='object'||Array.isArray(row)||
          Object.keys(row).length!==columns.length||
          Object.keys(row).some(x=>!names.has(x)))
          throw INVALID();
        const values=columns.map(x=>row[x]);
        if(values.some(v=>v!==null&&typeof v!=='string'&&!(typeof v==='number'&&Number.isSafeInteger(v))))
          throw INVALID();
        db.prepare('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+
          columns.map(()=>'?').join(',')+')').run(...values);
        restored++;
      }
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw INVALID();
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw INVALID();
    db.exec('COMMIT');
    return {tables:TABLES.length,rows:restored,integrity:'PASS',encrypted:true};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
export {sealTaskBackup,restoreTaskBackup,SCHEMA,SCHEMA_SHA,TABLES};
