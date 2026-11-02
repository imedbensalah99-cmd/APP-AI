// One-shot real public perimeter check for OMDA agent Staging.
// Safe for CI: two anonymous GETs only. No API tokens, prompts or payloads.
import {check} from './worker.mjs';
const outcome=await check(fetch);
const verdict={
  component:'omda-freellmapi-agent-watch-staging-v1',
  target:'omda-freellmapi-secure-staging-v1',
  healthHttp:outcome.healthCode,
  modelsWithoutAuthorizationHttp:outcome.modelsCode,
  state:outcome.state,
  agentsInferenceEnabled:false,
  paidRequestsMade:0,
  publishedContent:0
};
console.log(JSON.stringify(verdict));
if(outcome.state!=='PERIMETER_OK')process.exitCode=1;
