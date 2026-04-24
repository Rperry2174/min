# Side-by-Side Runbook

Run the Electron baseline and the Tauri migration target in parallel on the same machine.

## Prerequisites

- Node.js (tested with v23; project `.nvmrc` targets 15.7 but modern Node works fine)
- npm 10+
- Rust toolchain via `rustup` (required for Tauri only)
- Tauri CLI (`@tauri-apps/cli` is installed as a devDependency of `tauri-min/`)

Install once from the repo root:

```
npm install
```

The `postinstall` hook runs `scripts/setupDevEnv.js` automatically.

## Running Both Apps

Open two terminal windows from the repo root.

**Terminal 1 — Electron baseline:**

```
npm run start:electron
```

This runs `electron . --development-mode`.  The Electron build must exist first; if `main.build.js` is missing, run `npm run build` once.

**Terminal 2 — Tauri migration target:**

```
npm run start:tauri
```

This delegates to `npm --prefix tauri-min run dev` after prepending the Rust toolchain to PATH.  The Tauri CLI compiles the Rust crate on first run; expect a one-to-two minute compile on a cold cache.

## Validation

Run from the repo root at any time:

```
npm run validate:side-by-side
```

The script checks file presence, required scripts, and the director dry run, then prints a readiness summary:

```
=== Readiness Summary ===
PASS Electron app  (npm run start:electron)
PASS Tauri app     (npm run start:tauri)
PASS Director      (npm run cursor:director)
PASS Ledger        (migration/cursor-agents/ledger.json)
```

Add `--full` to also run the build and Rust compile gates (slower):

```
npm run validate:side-by-side -- --full
```

## What You Are Looking At

### Electron app

- Loads `index.html` → `dist/bundle.js` in a standard Chromium window via `electron`.
- Tabs are `WebContentsView` instances — real isolated renderer processes.
- `window.minRuntime` is injected by `js/runtime/electronRuntime.js` via `js/default.js`.
- Settings persist to Electron's `userData` path (OS-specific).

### Tauri migration target

- Loads `tauri-min/web/index.html` as the shell.
- `window.minRuntime` is provided by `tauri-min/web/runtime.js` via `@tauri-apps/api/core invoke()`.
- Settings persist to the Tauri `appDataDir` path via the `read_setting` / `write_setting` Rust commands.
- Tab navigation uses an `<iframe>` fallback — a deliberate spike that proves the command contracts before native child webviews are wired.

## Migration Features Status

Call `window.minRuntime.migrationFeatures()` from either app's devtools to get the current cluster status as JSON.  The Tauri implementation returns live data from the Rust `migration_features` command.

## Cloud Agent Director

The `cursor-tauri-director.js` script orchestrates cloud agents against the DAG:

```
npm run cursor:director -- --dry-run
```

Dry-run shows the full task graph without making API calls.  Requires `CURSOR_API_KEY` in `.env` or the environment for live runs.

## Troubleshooting

**`main.build.js` not found when starting Electron**

Run `npm run build` first.  The build output is gitignored.

**Rust compile errors on `npm run start:tauri`**

Ensure `rustup` is installed and `cargo` is resolvable:

```
rustup which cargo
```

The start script patches PATH automatically.  If `rustup` is missing, install it from https://rustup.rs and run `rustup default stable`.

**`tauri-min/node_modules` missing**

The `tauri-min` package is a separate npm workspace.  Run:

```
npm install --prefix tauri-min
```

Or run `npm install` from the repo root — the `postinstall` hook handles this.

**Tauri app window is blank**

The Tauri shell is a minimal migration target, not a full browser.  The address bar and navigation UI are intentionally stripped down.  Check the browser devtools (right-click → Inspect) for console errors.

**iframe tabs fail to load external URLs**

This is expected.  Most external pages set `X-Frame-Options: DENY`.  The iframe fallback is a prototype; see `docs/tauri-migration/webview-spike-gaps.md` for the full gap analysis and the path to native child webviews.
