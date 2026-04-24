# Feature Cluster Status

This file tracks the migration surface in mergeable clusters.

| Cluster | Electron Source | Tauri Status | Notes |
| --- | --- | --- | --- |
| Settings | `js/util/settings/settings.js`, `js/util/settings/settingsMain.js` | Prototype | `read_setting` and `write_setting` commands are wired with in-memory state. Durable app-data storage is the next increment. |
| Window controls | `main/remoteActions.js`, `js/windowControls.js` | Prototype | `minimize_window`, `toggle_maximize_window`, and `close_window` commands are available in Tauri. |
| Runtime bridge | `js/default.js` | Started | `window.minRuntime` exists in Electron and Tauri while legacy Electron globals remain intact. |
| Tab engine | `main/viewManager.js`, `js/webviews.js` | Spike | Tauri has tab state and iframe preview; native child webview parity remains unresolved. |
| Internal protocol | `main/minInternalProtocol.js` | Planned | Needs Rust-side path resolution with traversal checks before Min pages are loaded through Tauri. |
| Downloads | `main/download.js`, `js/downloadManager.js` | Planned | Electron `will-download` and `webRequest.onHeadersReceived` need a Tauri-specific design. |
| Credentials | `main/keychainService.js`, `js/passwordManager/keychain.js` | Planned | Electron `safeStorage` must move to a Rust/Tauri secret-storage implementation. |
| Menus | `main/menu.js`, `main/remoteMenu.js`, `js/menuRenderer.js` | Planned | Native menu and context menu APIs need a platform pass. |
| Permissions/filtering | `main/permissionManager.js`, `main/filtering.js`, `main/UASwitcher.js` | Planned | Electron `session` and `webRequest` APIs are a major parity gap. |

The status values are intentionally conservative. A cluster should not be marked complete until its Electron parity is implemented and validated through `npm run validate:side-by-side`.
