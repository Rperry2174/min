# Migration Status - Root Architecture Pass

_Branch: `cursor/root-migration-architecture-3111`_  
_Base: `cursor/tauri-migration-integration`_

---

## Current Repo State

### Electron app (root)
- **Build:** `npm run build` passes - Electron bundler (buildMain, buildBrowser, buildBrowserStyles, buildPreload) all succeed.
- **Lint (`npm test`):** Fails on pre-existing StandardJS violations scattered across legacy JS (`js/navbar/`, `js/places/`, `main/viewManager.js`, `main/windowManagement.js`, etc.). These violations existed before the migration scaffold was added and are **not caused by Tauri work**. See `docs/tauri-migration/baseline.md`.
- **Migration files pass lint:** `js/runtime/electronRuntime.js`, `scripts/cursor-tauri-director.js`, and `scripts/validateSideBySide.js` all pass StandardJS individually.

### Tauri scaffold (`tauri-min/`)
- Tauri v2 crate compiles and passes `npm run tauri:check` when `cargo` is on PATH via `rustup`.
- Rust layer: in-memory `SettingsState`, `TabState`, and Tauri commands for settings CRUD, tab CRUD, window chrome, app info, and `migration_features` inventory.
- Web layer: `tauri-min/web/runtime.js` exposes `window.minRuntime` via `@tauri-apps/api/core` `invoke()` - mirrors the shape in `js/runtime/electronRuntime.js`.
- Structural validation passes: `npm run validate:side-by-side`.

---

## DAG Refinement

The DAG in `migration/cursor-agents/tauri-migration-dag.json` has been updated:

1. **Replaced `npm test` gates with scoped lint** - `npm test` will not pass until the legacy JS is cleaned up (orthogonal work). Validation gates now use `npm exec standard -- <migration-file-list>` and `npm run build` instead.
2. **Added `npm run validate:side-by-side`** to all tasks from `tauri-foundation` onward - this is the meaningful structural gate.
3. **Added `_notes` field** to the DAG explaining the lint baseline situation for worker agents.

---

## Next Smallest Mergeable Unit

**Task: `tauri-foundation`**  
Branch: `cursor/tauri-foundation`  
Base: `cursor/tauri-root-architecture` (this PR merges first)

### What it should do

Implement durable settings storage as the first real parity feature, replacing the current in-memory `SettingsState` in `tauri-min/src-tauri/src/lib.rs`.

The `tauri-plugin-fs` and `tauri-plugin-os` plugins are already declared in `Cargo.toml` and registered in `lib.rs::run()`. The next increment uses them to read/write a JSON settings file in the OS app-data directory - matching how `js/util/settings/settings.js` writes to `localStorage` in the Electron renderer.

### Files owned by `tauri-foundation`

| File | Change |
|---|---|
| `tauri-min/src-tauri/src/lib.rs` | Replace `SettingsState` `HashMap<String,String>` with file-backed persistence using `tauri_plugin_fs` + `app.path().app_data_dir()`. Keep the same `read_setting` / `write_setting` command signatures. |
| `tauri-min/web/runtime.js` | No change required - command signatures are stable. |
| `docs/tauri-migration/feature-clusters.md` | Update Settings row from `Prototype` to `Foundation`. |

### Validation gates (from updated DAG)

```
npm run build
npm run tauri:check
npm run validate:side-by-side
```

### Why this is the right next unit

- Self-contained Rust change; no renderer/JS changes needed.
- The command API surface is already stable so `runtime-bridge` and downstream tasks are unaffected.
- Unblocks `runtime-bridge` (which needs to verify settings round-trip from the web layer) and `webview-spike` (which needs settings to persist tab state).
- Does not touch Electron code; `npm run build` must stay green.

---

## Parallel Work Opportunity

Once `tauri-foundation` is in flight, a second agent can start `runtime-bridge` work on its own branch - the only shared surface is the `window.minRuntime` API shape and the Tauri command signatures, both of which are frozen by this pass.

```json
[
  {
    "id": "tauri-foundation",
    "branch": "cursor/tauri-foundation",
    "fileOwnership": [
      "tauri-min/src-tauri/src/lib.rs",
      "docs/tauri-migration/feature-clusters.md"
    ],
    "validationGates": [
      "npm run build",
      "npm run tauri:check",
      "npm run validate:side-by-side"
    ],
    "blockedBy": []
  },
  {
    "id": "runtime-bridge",
    "branch": "cursor/tauri-runtime-bridge",
    "fileOwnership": [
      "js/runtime/electronRuntime.js",
      "tauri-min/web/runtime.js",
      "docs/tauri-migration/runtime-bridge.md"
    ],
    "validationGates": [
      "npm run build",
      "npm exec standard -- js/runtime/electronRuntime.js",
      "npm run tauri:check",
      "npm run validate:side-by-side"
    ],
    "blockedBy": ["tauri-foundation"]
  }
]
```

---

## High-Risk Surfaces (unchanged from baseline)

- **`main/viewManager.js`** - Electron `WebContentsView`-based tab engine; no direct Tauri equivalent yet (tracked as `webview-spike`).
- **`main/keychainService.js`** - `safeStorage`; needs Rust-side secret storage (`keyring` crate or `tauri-plugin-stronghold`).
- **`main/download.js` / `main/filtering.js`** - `session.will-download` and `webRequest.onHeadersReceived`; no Tauri plugin covers this yet.
- **`main/minInternalProtocol.js`** - Custom `min://` protocol; needs Rust handler with path-traversal checks.
