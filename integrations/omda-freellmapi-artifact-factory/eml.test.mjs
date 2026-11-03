import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,assertRequest} from './engine.mjs';
test('Arabic subject is folded as UTF-8 MIME encoded-words with bounded line lengths',()=>{
 const title='طلب تعديل الحضور والعمل في الفترة المسائية '.repeat(4);
 const r=execute({command:'Draft an email رسالة إدارية بخصوص الدوام',title:title.slice(0,150)});
 const eml=r.artifacts[0].content;
 assert.equal(r.artifacts[0].mime,'message/rfc822');
 assert.ok(eml.includes('MIME-Version: 1.0\r\n'));
 assert.ok(eml.includes('Content-Transfer-Encoding: base64'));
 assert.ok(eml.includes('Subject: =?UTF-8?B?'));
 for(const line of eml.split('\r\n'))assert.ok(line.length<=998);
 const body64=eml.split('\r\n\r\n')[1].replace(/\s/g,'');
 const bytes=Uint8Array.from(atob(body64),ch=>ch.charCodeAt(0));
 const decoded=new TextDecoder().decode(bytes);
 assert.ok(decoded.includes('رسالة إدارية'));
 assert.ok(decoded.includes('Best regards'));
 assert.ok(!eml.includes('To:'));
});
test('prevent header injection and unsafe recipient in command interface',()=>{
 const eml=execute({command:'Write email',title:'Normal\r\nBcc: attacker@example.com'}).artifacts[0].content;
 assert.ok(!eml.includes('\r\nBcc:'));
 assert.ok(eml.startsWith('Subject: Normal Bcc:'));
 assert.throws(()=>assertRequest({command:'Draft an email',recipient:'a@b.com\r\nBcc:bad'}));
});
test('unsent draft has no external actions or fake send response',()=>{
 const r=execute({command:'Draft email to colleague',recipient:'owner@example.org'});
 const eml=r.artifacts[0].content;
 assert.ok(eml.startsWith('To: owner@example.org\r\n'));
 assert.ok(eml.includes('X-OMDA-Draft: true'));
 assert.deepEqual(r.externalActions,[]);
 assert.equal(r.paidApiCalls,0);
});
