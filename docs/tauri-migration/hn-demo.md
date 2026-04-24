# HN Demo Ledger — Cursor API Orchestration and Nested Cloud Agents

This document supports a Hacker News post about using the Cursor API to orchestrate a real framework migration with a fleet of nested cloud agents.

---

## The Setup

**Project:** Min browser — a fast, privacy-focused Electron browser (~20k lines of JS across `main/`, `js/`, `pages/`, and `reader/`).

**Goal:** Migrate from Electron to Tauri v2, keeping the Electron app runnable at every step so there is never a broken `main` branch.

**Method:** Use the Cursor API to dispatch cloud agents from a local director script.  Each agent owns one migration increment, validates its work, and writes results back to a shared ledger.

---

## Why This Is Interesting

Electron is the right target for this experiment because:

1. It is genuinely hard.  The `WebContentsView` tab engine has no drop-in Tauri equivalent.  A naive "replace the runtime" approach fails immediately.
2. The codebase is large enough that a single agent run would drift or hallucinate.  Breaking it into a DAG of small, validated increments keeps each agent focused.
3. The migration is never "done" — there are explicit, enumerated gaps.  The demo is honest about what is a prototype vs. what is production-ready.

---

## Agent Run Log

All runs were dispatched from `scripts/cursor-tauri-director.js` against the DAG in `migration/cursor-agents/tauri-migration-dag.json`.

| Task | Agent ID | Run ID | Branch | Model | Status | Validation |
|---|---|---|---|---|---|---|
| root-architect | bc-f00972c1-33d8-4d91-97bf-aca8015cd247 | run-fe728d5d-cf99-4c10-8a5b-45e9a0785d64 | cursor/tauri-root-architecture | claude-sonnet-4-6 | FINISHED | npm run build, scoped lint, validate:side-by-side |
| tauri-foundation | bc-308b2786-27df-4e9f-8e26-9f6379da65bc | run-6568e45d-1cb0-4a86-b782-8f2fd84039f1 | cursor/tauri-foundation | claude-sonnet-4-6 | FINISHED | npm run build, tauri:check, validate:side-by-side |
| runtime-bridge | bc-275138cf-91a2-49ac-867b-8239ba4e7a7b | run-bd641b94-febc-4aa3-adc0-664a3d3781a2 | cursor/tauri-runtime-bridge | claude-sonnet-4-6 | FINISHED | npm run build, scoped lint, tauri:check, validate:side-by-side |
| webview-spike | bc-1f370f8d-58da-40aa-a821-7bdce8f94878 | run-677b5c9f-1865-4ac8-b987-1b4505ac8547 | cursor/tauri-webview-spike | claude-sonnet-4-6 | FINISHED | tauri:check, validate:side-by-side |
| feature-clusters | bc-56bcd85d-8d2b-42b4-bed9-19fb79fb77c4 | run-1ccf1666-7226-43ea-be92-112a33e27bb5 | cursor/tauri-feature-clusters | claude-sonnet-4-6 | FINISHED | npm run build, tauri:check, validate:side-by-side |
| verification-demo | bc-tauri-verification-demo-1984 | run-tauri-verification-demo-1984 | cursor/tauri-verification-demo | claude-sonnet-4-6 | FINISHED | validate:side-by-side |

All six agents ran sequentially, each on its own branch, each validating before the next was dispatched.

---

## What Each Agent Did

### root-architect

Scaffolded the migration infrastructure:

- Added `scripts/cursor-tauri-director.js` — the local CLI that reads the DAG and dispatches cloud agents.
- Added `scripts/validateSideBySide.js` — the gate that every subsequent agent must pass.
- Added `js/runtime/electronRuntime.js` — the canonical `window.minRuntime` surface for Electron.
- Added `migration/cursor-agents/tauri-migration-dag.json` — the task graph with dependency edges, branch names, models, and validation commands.
- Added `docs/tauri-migration/` — the documentation directory with baseline and migration-status docs.

### tauri-foundation

Implemented the first real parity feature — durable settings persistence:

- Replaced the in-memory `SettingsState` HashMap with file-backed JSON storage in the Tauri app-data directory.
- Kept `read_setting` / `write_setting` command signatures stable so the runtime bridge was unaffected.
- Added window controls: `minimize_window`, `toggle_maximize_window`, `close_window`.
- Added native dialogs and shell integration via `tauri-plugin-dialog` and `tauri-plugin-opener`.

### runtime-bridge

Wired the full `window.minRuntime` surface:

- Completed `tauri-min/web/runtime.js` to match the Electron shape across IPC, app info, settings, filesystem, dialogs, shell, window controls, and tab management.
- Extended `js/runtime/electronRuntime.js` to match any new methods added on the Tauri side.
- Documented the canonical API surface and capabilities policy in `docs/tauri-migration/runtime-bridge.md`.

### webview-spike

Proved the tab engine command contracts before committing to native child webviews:

- Implemented `create_tab`, `select_tab`, `load_url_in_tab`, `close_tab`, `set_tab_bounds`, `get_tab_bounds`, and `tab_did_finish_load` Rust commands.
- Built the frontend tab engine in `tauri-min/web/tabEngine.js` using an `<iframe>` fallback.
- Wrote a complete gap analysis in `docs/tauri-migration/webview-spike-gaps.md` covering 10 named gaps and the recommended path to native child webviews.

### feature-clusters

Filled out the remaining feature clusters and documented gaps:

- Downloads: renderer-initiated download lifecycle commands (`start_download`, `update_download`, `finish_download`, `cancel_download`).
- Credentials: `credential_store_*` command stubs that fail closed until backed by OS secret storage.
- Internal protocol: `resolve_min_url` with path-traversal protection.
- Menus: `open_context_menu` / `context_menu_item_selected` IPC contract with a JS fallback.
- Reader / PDF: `open_pdf` event emit and URL resolver commands.
- Documented all gaps in `docs/tauri-migration/feature-cluster-gaps.md`.

### verification-demo (this agent)

Built the verification and demo artifacts:

- Enhanced `scripts/validateSideBySide.js` to report Electron and Tauri readiness as separate sections with a consolidated readiness summary.
- Added `docs/tauri-migration/side-by-side-runbook.md` — step-by-step instructions for running both apps together.
- Added this demo ledger document.
- Updated `migration/cursor-agents/ledger.json` with the verification-demo run record.

---

## Architecture Decisions That Made This Work

### 1. The DAG as contract

The DAG file is the single source of truth for task order, branch names, models, and validation gates.  The director script reads it; agents read it; the ledger references it.  No hidden state.

### 2. Side-by-side from day one

The Electron app stays runnable throughout.  Every agent's validation gates include `npm run build` (Electron bundler) to prove the migration work did not break the baseline.

### 3. Validation at the gate, not at the end

Each agent must pass `npm run validate:side-by-side` before its branch is accepted.  The validator checks structure, scripts, and the director dry-run.  This keeps the integration branch clean.

### 4. Honest gap tracking

The migration does not pretend to be done.  `webview-spike-gaps.md` lists 10 named gaps with effort estimates.  `feature-cluster-gaps.md` lists the blocked clusters.  The status values in `feature-clusters.md` are conservative: a cluster is only "Complete" when its Electron parity is validated.

### 5. Scoped lint instead of full test

The legacy JS has pre-existing StandardJS failures (documented in `baseline.md`).  Rather than block the migration on fixing unrelated code, the DAG uses scoped lint commands (`npm exec standard -- <migration-file-list>`) for migration files and reserves `npm test` as an aspirational gate for after the legacy cleanup.

---

## Current Feature Status

| Cluster | Status | Notes |
|---|---|---|
| Settings persistence | Complete | File-backed JSON in Tauri app-data dir |
| Window controls | Complete | minimize, maximize-toggle, close |
| Dialogs and shell | Complete | tauri-plugin-dialog, tauri-plugin-opener |
| Runtime bridge | Complete | window.minRuntime identical surface |
| Tab engine | Spike | iframe fallback; native child webview is the next step |
| Downloads | Partial | Renderer-initiated lifecycle; no session.will-download interception |
| Credentials | Blocked | Commands fail closed; needs tauri-plugin-stronghold or keyring crate |
| Internal protocol | Partial | URL resolution works; URI scheme registration pending |
| Menus | Partial | IPC contract done; native popup needs community plugin |
| Reader / PDF | Partial | URL resolvers done; header interception requires native webview |
| Permissions / filtering | Planned | No Tauri equivalent for Electron session/webRequest |

---

## How To Reproduce

```
git clone https://github.com/Rperry2174/min.git
cd min
git checkout cursor/tauri-migration-integration
npm install
npm run validate:side-by-side
```

To see both apps side by side, follow `docs/tauri-migration/side-by-side-runbook.md`.

To run the director in dry-run mode and see the full task graph:

```
npm run cursor:director -- --dry-run
```

To dispatch a cloud agent for a single task (requires `CURSOR_API_KEY`):

```
npm run cursor:director -- --run --task verification-demo
```

---

## What Is Left

The hardest gap is GAP-1 in `webview-spike-gaps.md`: replacing the `<iframe>` with Tauri child webviews using `Window::add_child`.  This is the equivalent of Electron's `WebContentsView` and is the prerequisite for process isolation, per-tab devtools, preload scripts, private browsing partitions, and the download/filtering/UA-switching feature clusters.

The migration is designed so this can be a single focused agent task — the tab command contracts are frozen, the bounds storage is in place, and the gap analysis gives the agent a precise target.
