# Feature Cluster Status

This file tracks the migration surface in mergeable clusters.

| Cluster | Electron Source | Tauri Status | Notes |
| --- | --- | --- | --- |
| Settings persistence | `js/util/settings/settings.js`, `js/util/settings/settingsMain.js` | Complete | `read_setting` / `write_setting` persist JSON in the Tauri app-data directory. |
| Window controls | `main/remoteActions.js`, `js/windowControls.js` | Complete | `minimize_window`, `toggle_maximize_window`, `close_window` backed by `tauri::Window` APIs. |
| Dialogs and shell open/show | `main/remoteActions.js` (dialogs), `electron.shell` | Complete | `show_open_dialog`, `show_save_dialog`, `open_path`, `show_item_in_folder` backed by tauri-plugin-dialog and tauri-plugin-opener. |
| Runtime bridge | `js/default.js` | Complete | `window.minRuntime` exists in both Electron and Tauri with identical surface. |
| Tab engine | `main/viewManager.js`, `js/webviews.js` | Spike | Tab state + commands implemented; content uses iframe fallback. Native per-tab webview parity is the key gap — see `webview-spike-gaps.md`. |
| Downloads | `main/download.js`, `js/downloadManager.js` | Partial | `start_download` / `update_download` / `finish_download` / `cancel_download` track renderer-initiated downloads. **GAP:** `session.will-download` interception requires native child-webview support — see `feature-cluster-gaps.md`. |
| Credentials | `main/keychainService.js`, `js/passwordManager/keychain.js` | Partial | `credential_store_*` commands persist a JSON file in app-data. **GAP:** Electron `safeStorage` OS-keychain encryption is not replicated — plain JSON only. Replacement: `tauri-plugin-stronghold` or `keyring` crate. |
| Internal protocol | `main/minInternalProtocol.js` | Partial | `resolve_min_url` maps `min://app/<path>` to local paths with the same traversal check. **GAP:** Full URI-scheme registration (`tauri::Builder::register_uri_scheme_protocol`) is pending. |
| Menus and context menus | `main/menu.js`, `main/remoteMenu.js`, `js/menuRenderer.js` | Partial | `open_context_menu` / `context_menu_item_selected` / `context_menu_will_close` provide the IPC contract. **GAP:** Native popup rendering requires the community `tauri-plugin-context-menu` crate; current path falls back to a frontend JS menu. |
| Reader / PDF paths | `main/download.js` (PDF intercept), `reader/`, `pages/pdfViewer/` | Partial | `open_pdf` emits an `open-pdf` event to the shell. `get_reader_url` / `get_pdf_viewer_url` return Tauri-relative paths. **GAP:** `webRequest.onHeadersReceived` PDF interception requires native child-webview support. |
| Permissions / filtering | `main/permissionManager.js`, `main/filtering.js`, `main/UASwitcher.js` | Planned | Electron `session` and `webRequest` APIs are a major parity gap with no current Tauri equivalent. |

The status values are intentionally conservative.  A cluster should not be marked
**Complete** until its Electron parity is implemented and validated through
`npm run validate:side-by-side`.  **Partial** means the API surface is available
in both runtimes but one or more parity gaps are recorded in
`docs/tauri-migration/feature-cluster-gaps.md`.
