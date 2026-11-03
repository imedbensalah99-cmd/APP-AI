import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,classify,assertRequest,csvCell,website,jobPlan,email} from './engine.mjs';
test('English website, job, spreadsheet, email and documents route to distinct outputs',()=>{
 for(const [sentence,type] of [['make a website','website'],['find me jobs','job_research'],['create excel','spreadsheet'],['write an email','email'],['make a PDF report','document']]){
  assert.ok(classify(sentence).includes(type),sentence);
 }
});
test('Arabic requests and combined tasks use more than one specialist',()=>{
 const result=execute({command:'دور لي على وظائف في قطر، اعمل إكسل، اكتب إيميل، واعمل لي ويبسايت'});
 assert.deepEqual(result.intents,['website','spreadsheet','email','job_research']);
 assert.equal(result.artifacts.length,4);
});
test('Unknown requests get generic brief rather than fabricated external action',()=>{
 const res=execute({command:'Please help analyze this complex issue'});
 assert.deepEqual(res.intents,['general']);
 assert.equal(res.artifacts[0].path,'project/brief.md');
});
test('XSS and HTML injection in user title and instruction are escaped',()=>{
 const res=execute({command:'Make website for <script>alert("x")</script>',title:'<img src=x onerror=alert(1)>'});
 const html=res.artifacts[0].content;
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x onerror='));
 assert.ok(html.includes('name="viewport"'));
});
test('XLSX output has genuine ZIP/OOXML bytes, separate sheets and numeric cells',()=>{
 const res=execute({command:'Make excel tracker',rows:[{Item:'Product A',Price:10,Notes:'=HYPERLINK("bad","click")'},{Item:'Product B',Price:4,Notes:'\t+SUM(1,2)'}]});
 const sheet=res.artifacts[0];
 assert.equal(sheet.path,'spreadsheet/data.xlsx');
 assert.equal(sheet.mime,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 assert.ok(sheet.content instanceof Uint8Array);
 assert.deepEqual([...sheet.content.slice(0,4)],[80,75,3,4]);
 const data=new TextDecoder().decode(sheet.content);
 assert.ok(data.includes('<sheet name="Summary"'));
 assert.ok(data.includes('Product A'));
 assert.ok(data.includes('10</v>'));
 assert.ok(data.includes('=HYPERLINK'));
 assert.ok(data.includes('<f>COUNTA('));
 assert.ok(!data.includes('<f>=HYPERLINK'));
 assert.equal(csvCell('-2'),'"\\'-2"'.replace('\\\\','\\'));
});
test('Empty input produces labeled synthetic XLSX template, not fabricated real data',()=>{
 const sheet=execute({command:'Create excel sheet'}).artifacts[0];
 const data=new TextDecoder().decode(sheet.content);
 assert.ok(data.includes('Review generated template'));
 assert.ok(!data.includes('Real job offer'));
});
test('Email stays a local draft and does not silently invent a recipient',()=>{
 const result=execute({command:'Draft an email to follow up'});
 assert.equal(result.artifacts[0].path,'email/draft.eml');
 assert.ok(!result.artifacts[0].content.startsWith('To:'));
 assert.ok(result.artifacts[0].content.includes('X-OMDA-Draft: true'));
 assert.deepEqual(result.externalActions,[]);
});
test('Supplied email recipient appears only when valid',()=>{
 const s=email({command:'Draft email',recipient:'recruiter@example.org',title:'Application'});
 assert.ok(s.startsWith('To: recruiter@example.org'));
 assert.throws(()=>assertRequest({command:'Draft email',recipient:'x@y.com\r\nBcc:evil'}));
});
test('Job requests produce honest research task without claiming sourced vacancy',()=>{
 const j=JSON.parse(jobPlan({command:'Find AML jobs in Qatar'}));
 assert.equal(j.status,'RESEARCH_NOT_RUN');
 assert.ok(j.note.includes('No job advertisements'));
});
test('Doc requests are markdown drafts, not incorrectly labeled PDFs',()=>{
 const r=execute({command:'Create Word report'});
 assert.equal(r.artifacts[0].path,'document/brief.md');
 assert.ok(r.artifacts[0].content.includes('no PDF or DOCX'));
});
test('Rejects unexpected properties, oversized command, excessive rows and unsafe types',()=>{
 for(const bad of [
  {command:'ok',model:'paid'},{command:'x'.repeat(2501)},
  {command:'Create CSV',rows:Array.from({length:1001},()=>({A:1}))},
  {command:'Create CSV',rows:[{A:{nested:true}}]},
  {command:'Create CSV',rows:[{A:'x'.repeat(2001)}]},
  {command:'hello',title:'x'.repeat(151)}
 ]) assert.throws(()=>execute(bad));
});
test('No provider calls or publishing and safe filenames',()=>{
 const res=execute({command:'Build website and Excel and draft an email'});
 assert.equal(res.paidApiCalls,0);
 assert.equal(res.publishing,false);
 assert.deepEqual(res.externalActions,[]);
 for(const {path} of res.artifacts)assert.ok(!path.includes('..')&&!path.startsWith('/'));
});
