# OMDA Offline Command Router

A working **no-network** integration of existing OMDA Website Brief, Workflow Studio, and CSV Artifact Kit. It accepts a natural Arabic/English request and returns a structured plan plus an exportable CSV/JSON artifact.

## Quick use

```bash
node --input-type=module -e "import {routeCommand} from './integrations/omda-freellmapi-command-router/router.mjs'; console.log(routeCommand('اعمل لي إكسل').artifact.content)"
node --test integrations/omda-freellmapi-command-router/router.test.mjs
```

This is an offline library, not a deployed API or a live AI agent. It never researches actual jobs, sends emails, creates websites, or publishes. Supplied jobs are input data; CSV output is an export, not an XLSX workbook. Do not present generated content as live research. External actions require separately authorized adapters and review gates.

Rollback: revert the commits introducing this isolated folder and workflow.
