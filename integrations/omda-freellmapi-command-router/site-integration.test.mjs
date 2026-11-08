import test from 'node:test';
import assert from 'node:assert/strict';
import {routeCommand} from './router.mjs';

test('Arabic website request produces actual HTML with RTL',()=>{
 const result=routeCommand('اعمل موقع مطعم عربي',{site:{name:'مطعم تجريبي'}});
 assert.equal(result.kind,'website');
 assert.equal(result.artifact.mimeType,'text/html; charset=utf-8');
 assert.match(result.artifact.content,/<!doctype html>/i);
 assert.match(result.artifact.content,/dir="rtl"/);
 assert.match(result.artifact.content,/مطعم تجريبي/);
 assert.equal(result.artifact.published,false);
 assert.equal(result.networkCalls,0);
});
test('English website preview is offline and not published',()=>{
 const result=routeCommand('Create a portfolio website',{site:{name:'Demo Portfolio'}});
 assert.match(result.artifact.content,/Demo Portfolio/);
 assert.match(result.artifact.content,/dir="ltr"/);
 assert.equal(result.artifact.requiresExternalApproval,true);
 assert.equal(result.paidCalls,0);
});
test('Untrusted site name is HTML escaped',()=>{
 const result=routeCommand('Create a website',{site:{name:'<img src=x onerror=alert(1)>'}});
 assert.doesNotMatch(result.artifact.content,/<img src=x/);
 assert.match(result.artifact.content,/&lt;img/);
});
test('Invalid site name is rejected',()=>{
 assert.throws(()=>routeCommand('Create a website',{site:{name:'Bad\nName'}}),TypeError);
});
test('Email and spreadsheet routes remain available',()=>{
 assert.equal(routeCommand('Create an excel spreadsheet').kind,'spreadsheet');
 assert.equal(routeCommand('Draft an email for a job').kind,'email');
});
