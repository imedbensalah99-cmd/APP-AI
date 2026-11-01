import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validatePreview,renderPreview,generate} from './preview-generator.mjs';
test('escapes HTML input and refuses embedded scripts',()=>{
 const html=renderPreview({title:'<script>alert("x")</script>',description:'A & B'});
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('A &amp; B'));
});
test('rejects oversized, empty and control-containing inputs',()=>{
 for(const title of ['', 'X'.repeat(81),'hi\u0000']) assert.throws(()=>validatePreview({title}),/Invalid title/);
 assert.throws(()=>validatePreview({description:'X'.repeat(501)}),/Invalid description/);
});
test('writes real files with verified checksum',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'omda-pilot-'));
 try{
  const m=await generate({title:'QA Test',description:'Generated via GitHub Actions'},dir);
  const html=await readFile(join(dir,'index.html'),'utf8');
  const saved=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
  assert.equal(m.sha256,createHash('sha256').update(html).digest('hex'));
  assert.deepEqual(saved,m);
  assert.match(html,/QA Test/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
