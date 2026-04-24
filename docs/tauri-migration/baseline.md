# Electron Baseline For Tauri Migration

This document captures the starting point for the side-by-side Electron to Tauri migration.

## Environment

- Repository: `min`
- Electron app entry: `main.build.js`, generated from `scripts/buildMain.js`
- Electron source entry: `main/main.js`
- Renderer entry: `index.html` loading `dist/bundle.js` and `dist/bundle.css`
- Preload output: `dist/preload.js`
- Current shell Node: `v23.11.0`
- Project `.nvmrc`: `15.7.0`
- npm: `10.9.2`
- Rust: available through `rustup`, but `cargo` is not currently on PATH in the shell environment

## Baseline Commands

The first baseline run was intentionally performed before installing dependencies:

```text
npm test
```

Initial result: failed because `standard` was not installed locally.

After dependency installation, `npm test` runs but fails on existing broad StandardJS issues across the legacy codebase. The new migration scripts and runtime bridge were linted separately and pass:

```text
npm exec standard -- js/runtime/electronRuntime.js scripts/cursor-tauri-director.js scripts/validateSideBySide.js
```

```text
npm run build
```

Initial result: failed because `decomment` was not installed locally.

After dependency installation, `npm run build` passes.

The Tauri scaffold gate also passes after adding the Rust toolchain path from `rustup`:

```text
npm run tauri:check
```

The full migration gate remains:

```text
npm test
npm run build
```

## High-Risk Electron Surfaces

- `main/main.js`: app lifecycle, windows, menu, custom protocol, sessions, and shell integration.
- `main/viewManager.js`: tab engine based on Electron `WebContentsView` and per-tab `webContents` operations.
- `js/webviews.js`: renderer-side tab engine using Electron IPC channels.
- `js/default.js`: shell renderer bootstrap exposing `window.electron`, `window.fs`, and `window.ipc`.
- `main/download.js`, `main/filtering.js`, `main/UASwitcher.js`: Electron `session` and `webRequest` behavior.
- `main/keychainService.js`: Electron `safeStorage` password file encryption.
- `main/minInternalProtocol.js`: `min://app/...` protocol serving with path traversal checks.

## Migration Rule

The Electron application must remain runnable while `tauri-min/` evolves. Root validation should always check that Electron build and lint behavior has not regressed before accepting Tauri work.
