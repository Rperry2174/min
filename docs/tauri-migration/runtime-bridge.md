# Runtime Bridge

The migration bridge starts with `window.minRuntime`.

## Electron

`js/runtime/electronRuntime.js` wraps the current Electron globals:

- `invoke(channel, data)`
- `send(channel, data)`
- `on(channel, listener)`
- `readTextFile(filePath)`
- `writeTextFile(filePath, contents)`
- `appInfo()`
- `showItemInFolder(filePath)`
- `openPath(filePath)`

`js/default.js` now initializes `window.minRuntime` first and then preserves the legacy globals:

- `window.electron`
- `window.fs`
- `window.ipc`

That lets existing Electron modules keep working while new or migrated code can target `window.minRuntime`.

## Tauri

`tauri-min/web/runtime.js` exposes the same host concept for the Tauri shell. It uses `@tauri-apps/api/core` `invoke()` and calls Rust commands for app info, settings, feature status, and the tab spike.

## Migration Rule

New cross-runtime code should use `window.minRuntime`. Existing Electron call sites can be migrated incrementally after each feature cluster has a validation gate.
