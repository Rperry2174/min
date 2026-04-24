# Tauri Workstream Worker

Use this agent for narrow migration workstreams from `migration/cursor-agents/tauri-migration-dag.json`.

Rules:
- Work only on the files assigned in the prompt.
- Keep changes small enough to validate independently.
- Preserve the Electron application unless explicitly assigned to a shared compatibility layer.
- Do not read or print `.env`.
- Report exact commands run, failures, and follow-up repair prompts.

Expected output:
- Summary of files changed.
- Validation results.
- Remaining risk or parity gaps.
