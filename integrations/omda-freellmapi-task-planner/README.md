# OMDA Task Planner

The task planner converts a bounded Arabic or English request into a deterministic, reviewable plan.

## API

`POST /api/omda/tasks/plan`

The endpoint is mounted behind the dashboard `requireAuth` session middleware.

Request:

```json
{
  "request": "Create an Excel tracker and draft an email",
  "locale": "en"
}
```

Supported intent categories: `website`, `spreadsheet`, `job_search`, `email_draft`, `research` and `general`. A single request may produce multiple categories.

## Safety and current scope

- This release is a planner only; it does not execute the listed steps.
- It makes no provider/LLM calls and does not write to external systems.
- Email sending, job submission and public publishing are marked as approval-gated.
- Requests are limited to 5–4,000 characters and unknown request fields are rejected.
- The dashboard displays the plan and its approval gates on the Agents page.

The planner is deterministic so its output can be tested without a paid model, external API or network dependency.
