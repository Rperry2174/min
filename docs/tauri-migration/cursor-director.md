# Cursor Cloud Director

`scripts/cursor-tauri-director.js` is the local controller for the cloud-first migration story.

It reads the migration DAG from `migration/cursor-agents/tauri-migration-dag.json`, creates Cursor Cloud Agents through the Cloud Agents API v1, records `agentId` and `runId`, waits for terminal run status, and writes a sanitized ledger to `migration/cursor-agents/ledger.json`. The DAG targets the writable fork `https://github.com/Rperry2174/min.git` and starts from `cursor/tauri-migration-integration`; the original project is kept as the `upstream` remote.

## Dry Run

```text
npm run cursor:director
```

The default mode is a dry run. It prints task IDs, target branches, models, dependencies, and validation gates without reading `.env` or contacting the API.

## Cloud Run

```text
npm run cursor:director -- --run --task tauri-foundation
```

Cloud mode requires `CURSOR_API_KEY` in the environment or `.env`. The script must not print the key. It validates the selected model against `/v1/models` before creating an agent.

## Merge Discipline

The director intentionally does not auto-merge branches. A completed cloud branch still needs local validation:

```text
npm test
npm run build
npm run tauri:check
npm run validate:side-by-side
```

Failed cloud runs stay in the ledger and should be handed to a repair agent with the failing task ID, branch, and validation output.
