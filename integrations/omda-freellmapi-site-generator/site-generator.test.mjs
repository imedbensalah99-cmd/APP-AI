import test from 'node:test';
import assert from 'node:assert/strict';
import {generateSite} from './site-generator.mjs';
test('Arabic restaurant RTL, menu and gallery',()=>{const r=generateSite('موقع مطعم مع قائمة الطعام وصور',{name:'مطعم التجربة'});assert.match(r.content,/dir="rtl"/);assert.match(r.content,/id="menu"/);assert.match(r.content,/id="gallery"/);assert.equal(r.published,false);});
test('English site has safe noindex and CSP',()=>{const r=generateSite('Build a portfolio website');assert.match(r.content,/lang="en"/);assert.match(r.content,/noindex,nofollow/);assert.match(r.content,/Content-Security-Policy/);});
test('Escapes user content',()=>{const r=generateSite('Build a website',{name:'<script>alert(1)</script>',description:'<img src=x>'});assert.doesNotMatch(r.content,/<script>|<img src=x>/);assert.match(r.content,/&lt;script&gt;/);});
test('Rejects invalid inputs',()=>{assert.throws(()=>generateSite('a'));assert.throws(()=>generateSite('Build website',{name:'\n'}));assert.throws(()=>generateSite('Build website',{description:'x'.repeat(501)}));});
test('No external action',()=>{const r=generateSite('Restaurant booking and payment website');assert.equal(r.paidCalls,0);assert.equal(r.networkCalls,0);assert.equal(r.requiresExternalApproval,true);assert.doesNotMatch(r.content,/<form/);});
