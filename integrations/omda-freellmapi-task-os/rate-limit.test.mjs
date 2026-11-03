import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SCHEMA} from './recovery.mjs';
import {chargeRateLimit} from './worker.mjs';

const owner='signed-owner-abcd-1234';
const T0=Date.parse('2026-11-03T12:00:00.000Z');
function fixture(){const d=new DatabaseSync(':memory:');d.exec(SCHEMA);return {
  sqlite:d,
  prepare(sql){return {bind(...params){return {first:async()=>d.prepare(sql).get(...params)||null};}}}
};}
test('atomic SQLite rate gate permits exactly 30 calls, then 429 equivalent',async()=>{
  const db=fixture();
  for(let i=0;i<30;i++)assert.equal(await chargeRateLimit(db,owner,T0+i),true);
  for(let i=0;i<7;i++)assert.equal(await chargeRateLimit(db,owner,T0+40+i),false);
  assert.equal(db.sqlite.prepare('SELECT consumed FROM omda_task_request_limits').get().consumed,30);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM omda_task_request_limits').get().n,1);
  db.sqlite.close();
});
test('next minute resets quota instead of adding historic rows',async()=>{
  const db=fixture();
  for(let i=0;i<30;i++)await chargeRateLimit(db,owner,T0);
  assert.equal(await chargeRateLimit(db,owner,T0+60001),true);
  assert.equal(db.sqlite.prepare('SELECT consumed FROM omda_task_request_limits').get().consumed,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM omda_task_request_limits').get().n,1);
  db.sqlite.close();
});
test('quotas are independent across verified owner scopes',async()=>{
  const db=fixture();
  for(let i=0;i<30;i++)await chargeRateLimit(db,owner,T0);
  assert.equal(await chargeRateLimit(db,'signed-owner-other-1234',T0),true);
  assert.equal(await chargeRateLimit(db,owner,T0),false);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM omda_task_request_limits').get().n,2);
  db.sqlite.close();
});
test('invalid owner scope fails the schema constraint, never bypasses limit',async()=>{
  const db=fixture();
  await assert.rejects(()=>chargeRateLimit(db,'a',T0));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM omda_task_request_limits').get().n,0);
  db.sqlite.close();
});
