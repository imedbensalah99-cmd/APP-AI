import test from 'node:test';
import assert from 'node:assert/strict';
import {xlsx} from './xlsx.mjs';
const decoded = bytes => new TextDecoder().decode(bytes);
test('real OOXML ZIP with two worksheets, styles, frozen headers and calculated summary formula',()=>{
  const bytes=xlsx([{Name:'عماد',Amount:12.5,Status:'Completed'},{Name:'Émilie',Amount:2,Status:'Draft'}]);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.deepEqual([...bytes.slice(-22,-18)],[0x50,0x4b,0x05,0x06]);
  const xml=decoded(bytes);
  assert.ok(xml.includes('<sheet name="Data"'));
  assert.ok(xml.includes('<sheet name="Summary"'));
  assert.ok(xml.includes('pane ySplit="1"'));
  assert.ok(xml.includes('<autoFilter ref="A1:C3"'));
  assert.ok(xml.includes('<f>COUNTA(Data!A2:A3)</f>'));
  assert.ok(xml.includes('<f>COUNTIF(Data!C2:C3,&quot;Completed&quot;)</f>'));
  assert.ok(xml.includes('12.5</v>'));
  assert.ok(xml.includes('عماد'));
  assert.ok(xml.includes('Émilie'));
});
test('untrusted formula looking text stays inlineStr, not executable',()=>{
  const xml=decoded(xlsx([{Notes:'=HYPERLINK("http://evil","click")',Other:'\t+SUM(1,1)'},{Notes:'@cmd',Other:'-2'}]));
  for(const v of ['=HYPERLINK','\t+SUM','@cmd','-2']) assert.ok(xml.includes(v));
  assert.ok(!xml.includes('<f>HYPERLINK'));
  assert.ok(!xml.includes('<f>SUM'));
  assert.ok(xml.includes('t="inlineStr"'));
});
test('XML escapes HTML injection and illegal control characters',()=>{
  const xml=decoded(xlsx([{A:'<script>alert(1)</script>& "yes" \u0001'}]));
  assert.ok(xml.includes('&lt;script&gt;'));
  assert.ok(xml.includes('&amp;'));
  assert.ok(!xml.includes('<script>'));
  const dataPart=xml.slice(xml.indexOf('<t xml:space="preserve">'),xml.indexOf('</t>')+4);
  assert.ok(!dataPart.includes('\u0001'));
});
test('zero input is honest template and valid single row and 1000 row boundaries',()=>{
  assert.ok(decoded(xlsx([])).includes('Synthetic template'));
  assert.ok(decoded(xlsx([{A:'x'}])).includes('A2:A2'));
  const b=xlsx(Array.from({length:1000},(_,i)=>({Number:i,Name:'Row '+i})));
  assert.ok(b.length>1000);
  assert.ok(decoded(b).includes('<row r="1001">'));
});
test('reject oversized or invalid input with no side effects',()=>{
  assert.throws(()=>xlsx(Array.from({length:1001},()=>({A:1}))));
  assert.throws(()=>xlsx([{Amount:Number.NaN}]));
  assert.throws(()=>xlsx([{Amount:Infinity}]));
  assert.throws(()=>xlsx([{Nested:{private:true}}]));
  assert.throws(()=>xlsx([{A:'x'.repeat(2001)}]));
  assert.throws(()=>xlsx([Object.fromEntries(Array.from({length:21},(_,i)=>['K'+i,1]))]));
});
