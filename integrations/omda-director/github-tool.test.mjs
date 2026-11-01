import test from 'node:test';import assert from 'node:assert/strict';
import {dispatchGithubBuild} from './github-tool.mjs';
const p={task:'create_static_preview',title:'OMDA test',description:'Generated internally'};
test('default is disabled: no outbound network calls',async()=>{let calls=0;assert.deepEqual(await dispatchGithubBuild({},p,async()=>{calls++;throw Error('called')}),{status:'DISABLED'});assert.equal(calls,0)});
test('enabled without secret fails closed',async()=>{assert.equal((await dispatchGithubBuild({OMDA_GITHUB_BUILD_ENABLED:'true'},p)).status,'NOT_CONFIGURED')});
test('only one safe build action allowed',async()=>{await assert.rejects(dispatchGithubBuild({OMDA_GITHUB_BUILD_ENABLED:'true',OMDA_GITHUB_TOKEN:'test'},{...p,task:'run_shell_command'},async()=>({status:204})),/allowlisted/)});
test('dispatch only to fixed workflow/ref; token never in request body',async()=>{let seen;const res=await dispatchGithubBuild({OMDA_GITHUB_BUILD_ENABLED:'true',OMDA_GITHUB_TOKEN:'test-only'},p,async(url,options)=>{seen={url,...options};return {status:204}});assert.equal(res.status,'ACCEPTED');assert.match(seen.url,/\/omda-agent-build.yml\/dispatches$/);assert.equal(JSON.parse(seen.body).ref,'main');assert.ok(!seen.body.includes('test-only'))});
