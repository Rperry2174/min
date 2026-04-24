# Verification And Demo Agent

Build the side-by-side verification and Hacker News demo artifacts.

Constraints:
- Do not expose `.env` or API keys.
- Capture commands, statuses, agent IDs, run IDs, branch names, and validation summaries.
- Prefer deterministic text artifacts and optional screenshots.
- Make failures visible and actionable.

Success:
- `npm run validate:side-by-side` reports Electron and Tauri readiness.
- Migration docs explain how to run both apps side by side.
- The demo ledger can support a post about Cursor API orchestration and nested cloud agents.
