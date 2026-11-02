import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupDbNow, restoreDbBackupIfNeeded, isDbBackupConfigured } from '../../lib/db-backup.js';
// @ts-ignore -- standalone Cloudflare Worker is intentionally untyped JS.
import freshWorker from '../../../../integrations/omda-freellmapi-fresh-store/worker.mjs';

const FRESH_URL='https://omda-freellmapi-fresh-backup-v1.imedbensalah9988.workers.dev/freeapi.db.backup';
const KEYS=[
  'OMDA_FREELLMAPI_FRESH_ONLY','FREEAPI_DB_BACKUP_TARGET',
  'FREEAPI_DB_BACKUP_URL','FREEAPI_DB_BACKUP_PATH',
  'FREEAPI_DB_BACKUP_TOKEN','FREEAPI_DB_BACKUP_KEY',
  'FREEAPI_DB_BACKUP_RESTORE_ONLY','ENCRYPTION_KEY'
] as const;
const original=Object.fromEntries(KEYS.map(k=>[k,process.env[k]])) as Record<string,string|undefined>;
const dirs:string[]=[];

function prepareEnv(){
  for(const k of KEYS)delete process.env[k];
  process.env.OMDA_FREELLMAPI_FRESH_ONLY='true';
  process.env.FREEAPI_DB_BACKUP_TARGET=FRESH_URL;
  process.env.FREEAPI_DB_BACKUP_TOKEN='t'.repeat(64);
  process.env.FREEAPI_DB_BACKUP_KEY='a'.repeat(64);
  process.env.ENCRYPTION_KEY='b'.repeat(64);
  process.env.FREEAPI_DB_BACKUP_RESTORE_ONLY='false';
}

function fakeStore(){
 const versions=new Map<string,{version_id:string;sha256:string;size_bytes:number;chunk_count:number}>();
 const chunks=new Map<string,Array<{ordinal:number;payload_b64:string}>>();
 let current:string|null=null;
 const invoke=(sql:string,args:any[])=>{
   if(sql.startsWith('SELECT v.sha256')){const v=versions.get(current||'');return v?{sha256:v.sha256,size_bytes:v.size_bytes}:null;}
   if(sql.startsWith('SELECT v.version_id'))return versions.get(current||'')||null;
   if(sql.startsWith('SELECT ordinal'))return {results:(chunks.get(args[0])||[]).slice().sort((a,b)=>a.ordinal-b.ordinal)};
   if(sql.startsWith('INSERT INTO fresh_backup_versions')){versions.set(args[0],{version_id:args[0],sha256:args[1],size_bytes:args[2],chunk_count:args[3]});return{};}
   if(sql.startsWith('INSERT INTO fresh_backup_chunks')){const c=chunks.get(args[0])||[];c.push({ordinal:args[1],payload_b64:args[2]});chunks.set(args[0],c);return{};}
   if(sql.startsWith('INSERT INTO fresh_backup_head')){current=args[0];return{};}
   throw Error('Unexpected D1 operation');
 };
 const db={
   prepare(sql:string){let args:any[]=[];return{
     bind(...p:any[]){args=p;return this},
     async first(){return invoke(sql,args)},
     async all(){return invoke(sql,args)},
     async run(){return invoke(sql,args)}
   }},
   async batch(statements:Array<{run:()=>Promise<unknown>}>){for(const s of statements)await s.run();return[];}
 };
 return {env:{FRESH_BACKUPS:db,BACKUP_TOKEN:'t'.repeat(64)},versions,chunks,getCurrent:()=>current};
}

function makeDatabase(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'omda-fresh-backup-e2e-'));
 dirs.push(dir);
 const source=path.join(dir,'fresh.db');
 const destination=path.join(dir,'restored.db');
 const db=new Database(source);
 db.exec("CREATE TABLE synthetic_accounts (label TEXT NOT NULL); INSERT INTO synthetic_accounts VALUES ('new-account-only');");
 return {db,source,destination};
}
afterEach(()=>{
 vi.unstubAllGlobals();
 for(const k of KEYS){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k];}
 for(const dir of dirs.splice(0)){fs.rmSync(dir,{recursive:true,force:true});}
});

describe('OMDA FreeLLMAPI fresh-only backup integration (no external requests)',()=>{
 it('rejects legacy or missing backup targets before any read or write',()=>{
   prepareEnv();
   process.env.FREEAPI_DB_BACKUP_TARGET='https://omda-freellmapi-backup-v1.imedbensalah9988.workers.dev/freellmapi.db.backup';
   expect(()=>isDbBackupConfigured()).toThrow(/dedicated new backup URL/);
   delete process.env.FREEAPI_DB_BACKUP_TARGET;
   expect(()=>isDbBackupConfigured()).toThrow(/dedicated new backup URL/);
   process.env.FREEAPI_DB_BACKUP_TARGET=FRESH_URL+'?legacy=1';
   expect(()=>isDbBackupConfigured()).toThrow(/dedicated new backup URL/);
   process.env.FREEAPI_DB_BACKUP_TARGET=FRESH_URL;
   expect(isDbBackupConfigured()).toBe(true);
 });
 it('roundtrips real encrypted SQLite bytes via isolated Worker + mock D1 and restores integrity',async()=>{
   prepareEnv();
   const store=fakeStore(),{db,source,destination}=makeDatabase();
   const calls:Array<{path:string;method:string;status:number}>=[];
   vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
     const req=new Request(url,init);
     const response=await freshWorker.fetch(req,store.env);
     calls.push({path:new URL(url).pathname,method:req.method,status:response.status});
     return response;
   });
   try{expect((await backupDbNow(db,source)).ok).toBe(true);}finally{db.close();}
   expect(store.versions.size).toBe(1);
   expect(calls).toEqual([{path:'/freeapi.db.backup',method:'PUT',status:200}]);
   const restore=await restoreDbBackupIfNeeded(destination);
   expect(restore.restored).toBe(true);
   expect(calls[1]).toEqual({path:'/freeapi.db.backup',method:'GET',status:200});
   const check=new Database(destination,{readonly:true});
   try{
     expect(check.pragma('integrity_check',{simple:true})).toBe('ok');
     expect(check.prepare('SELECT label FROM synthetic_accounts').get()).toEqual({label:'new-account-only'});
   }finally{check.close();}
   // The already-restored file is never overwritten on a subsequent restore attempt.
   expect((await restoreDbBackupIfNeeded(destination)).skipped).toBe('database already exists');
   expect(calls).toHaveLength(2);
 });
 it('fails closed on wrong encryption key without leaving a destination SQLite file',async()=>{
   prepareEnv();
   const store=fakeStore(),{db,source,destination}=makeDatabase();
   vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>freshWorker.fetch(new Request(url,init),store.env));
   try{await backupDbNow(db,source);}finally{db.close();}
   process.env.FREEAPI_DB_BACKUP_KEY='c'.repeat(64);
   await expect(restoreDbBackupIfNeeded(destination)).rejects.toThrow('could not restore SQLite backup');
   expect(fs.existsSync(destination)).toBe(false);
 });
 it('rejects unauthenticated backup writes without modifying the new D1',async()=>{
   prepareEnv();
   const store=fakeStore(),{db,source}=makeDatabase();
   process.env.FREEAPI_DB_BACKUP_TOKEN='x'.repeat(64);
   vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>freshWorker.fetch(new Request(url,init),store.env));
   try{await expect(backupDbNow(db,source)).rejects.toThrow(/HTTP 401/);}finally{db.close();}
   expect(store.versions.size).toBe(0);
 });
});
