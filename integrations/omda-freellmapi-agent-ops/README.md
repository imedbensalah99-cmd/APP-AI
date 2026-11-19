# OMDA Agent Operations API

This isolated API exposes the existing staging profile policy and its current SQLite quota state to an authenticated dashboard operator. It also provides a prompt-safe preflight check.

## Endpoints

All endpoints require the existing dashboard session (Authorization: Bearer dashboard-session):

- GET /api/omda-agent/policy — read the exact server policy and whether inference is enabled.
- GET /api/omda-agent/quota — read daily/per-minute quota usage. The endpoint never creates the quota table.
- POST /api/omda-agent/preflight — validate a candidate request against the same payload contract used by the inference guard.

## Preflight example

~~~json
{
  "model": "openai/gpt-oss-20b",
  "max_tokens": 128,
  "temperature": 0.2,
  "stream": false,
  "messages": [
    { "role": "system", "content": "Follow the approved staging policy." },
    { "role": "user", "content": "Summarize the supplied status." }
  ]
}
~~~

The endpoint returns reason codes and aggregate metadata only. It never echoes prompt content, calls a provider, reserves quota, or stores the request. The request body is capped at 8 KiB.

## Important semantics

- policyMatch means the payload matches the exact staging request shape; it is not an execution grant.
- eligibleForAttempt is an advisory snapshot that also checks the server inference flag and current quota. The live inference guard still revalidates and reserves quota atomically.
- An uninitialized quota table is reported as unknown/not initialized. This read-only API does not create it.
- The staging profile remains limited to the configured Groq text model, 128 output tokens, non-streaming requests, one request per minute, and ten requests per UTC day.
- Media and tool payloads remain disallowed.
- The route is mounted behind the dashboard-session middleware. It is not a public endpoint and does not expose credentials or provider keys.

## Validation

Run the focused tests and TypeScript build:

~~~bash
npm ci
npm run test -w server -- src/__tests__/lib/omda-agent-policy.test.ts
npm run build -w server
~~~

No deployment, D1 mutation, provider call, email, publication, or paid API is part of this change.
