# Runtime Bridge

The migration bridge starts with `window.minRuntime`.

## Design

New cross-runtime code should use `window.minRuntime`.  Existing Electron call
sites can be migrated incrementally after each feature cluster has a validation
gate.  Legacy globals (`window.electron`, `window.fs`, `window.ipc`) are kept
in the Electron boot path and must not be removed until all call sites have
migrated.

## Canonical API surface

Both the Electron and Tauri implementations expose the same methods:

### IPC

| Method | Electron | Tauri |
|--------|----------|-------|
| `invoke(channel, data)` | `ipcRenderer.invoke` | `@tauri-apps/api/core` `invoke` |
| `send(channel, data)` | `ipcRenderer.send` | no-op stub |
| `on(channel, listener)` | `ipcRenderer.on` | no-op stub |

`send` and `on` stubs are provided on Tauri so that feature-detecting code does
not throw.  Callers that need bidirectional events on Tauri should use the
`@tauri-apps/api/event` module directly.

### App info

```js
window.minRuntime.appInfo()
// → Promise<{ productName, runtime, platform }>
```

### Settings

```js
window.minRuntime.readSetting(key)
// → Promise<{ key, value }>

window.minRuntime.writeSetting(key, value)
// → Promise<{ key, value }>
```

Settings are persisted to a JSON file.  On Electron the renderer settings
module is used as the authoritative source (it handles multi-window sync via
IPC).  On Tauri the `read_setting` / `write_setting` Rust commands persist to
the Tauri app-data directory.

### Filesystem (text files)

```js
window.minRuntime.readTextFile(filePath)
// → string (Electron, synchronous) | Promise<string> (Tauri)

window.minRuntime.writeTextFile(filePath, contents)
// → void (Electron) | Promise<void> (Tauri)
```

Restricted to UTF-8 text.  Binary file access should be implemented as a
dedicated command with appropriate path validation.

### Native dialogs

```js
window.minRuntime.showOpenDialog(options)
// → Promise<string[]>   – array of selected paths (empty if cancelled)

window.minRuntime.showSaveDialog(options)
// → Promise<string|null>  – selected path or null if cancelled
```

Options accepted (both runtimes):
- `title` – dialog window title
- `defaultPath` – initial directory or filename
- `multiple` – allow multiple file selection (open only)
- `directory` – pick a directory instead of a file (open only)
- `filters` – `[{ name, extensions }]`

**Capability notes:** Both `showOpenDialog` and `showSaveDialog` are backed by
`tauri-plugin-dialog` on Tauri.  The existing `"dialog:default"` entry in
`capabilities/default.json` covers these APIs; no additional capability scope
was required.

### Shell integration

```js
window.minRuntime.showItemInFolder(filePath)
// → Promise<void>  – reveals the parent directory

window.minRuntime.openPath(filePath)
// → Promise<void>  – opens the path with the system default application
```

**Capability notes:** `openPath` and `showItemInFolder` are backed by
`tauri-plugin-opener`.  The existing `"opener:default"` entry in
`capabilities/default.json` covers these APIs; no additional capability scope
was required.

### Window controls

```js
window.minRuntime.minimizeWindow()     // → Promise<void>
window.minRuntime.toggleMaximizeWindow() // → Promise<void>
window.minRuntime.closeWindow()        // → Promise<void>
```

### Tab management (spike, Tauri only)

```js
window.minRuntime.createTab(url)  // → Promise<Tab>
window.minRuntime.selectTab(id)   // → Promise<Tab[]>
window.minRuntime.listTabs()      // → Promise<Tab[]>
window.minRuntime.closeTab(id)    // → Promise<Tab[]>
```

These are Tauri-specific spike commands.  The Electron implementation does not
expose them; callers should guard with `window.minRuntime.host === 'tauri'`.

### Migration introspection

```js
window.minRuntime.migrationFeatures()
// → Promise<Array<{ id, label, status, notes }>>
```

Returns the list of feature clusters and their migration status.

## Electron

`js/runtime/electronRuntime.js` implements the canonical surface backed by
existing Electron globals.

`js/default.js` initialises `window.minRuntime` first and then preserves legacy
globals:

- `window.electron`
- `window.fs`
- `window.ipc`

## Tauri

`tauri-min/web/runtime.js` implements the canonical surface backed by
`@tauri-apps/api/core` `invoke()` and Rust commands registered in
`tauri-min/src-tauri/src/lib.rs`.

## Capabilities policy

New Tauri capabilities must be documented here with a rationale before being
added to `capabilities/default.json`.

| Permission | Rationale |
|------------|-----------|
| `core:default` | Required for fundamental Tauri IPC. |
| `dialog:default` | Covers `show_open_dialog` and `show_save_dialog`. |
| `fs:default` | Retained for future use; `read_text_file` / `write_text_file` use `std::fs` directly rather than the plugin. |
| `opener:default` | Covers `open_path` and `show_item_in_folder`. |
| `os:default` | Platform detection used by migration tooling. |
| `process:default` | Allows the frontend to trigger a clean app exit. |
| `shell:default` | Retained for the shell plugin; direct shell execution is not exposed through minRuntime. |
