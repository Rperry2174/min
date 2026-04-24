# Feature Cluster Parity Gaps

**Branch:** `cursor/tauri-feature-clusters`  
**Date:** 2026-04-24  
**Source of truth for:** `migration_features()` Rust command and `feature-clusters.md`

This document records every known parity gap between the Tauri feature-cluster
implementation and the equivalent Electron behaviour.  Gaps are labelled
`FC-GAP-<N>` for cross-referencing.

---

## Cluster: Downloads

### FC-GAP-1 - No session.will-download interception

**Electron behaviour:**  
`session.defaultSession.on('will-download', handler)` in `main/download.js`
intercepts every download item regardless of how it was triggered (navigation,
Content-Disposition header, `webContents.downloadURL()`).  The renderer receives
live progress via `sendIPCToWindow(win, 'download-info', ...)`.

**Tauri prototype:**  
`start_download` / `update_download` / `finish_download` track downloads that
the renderer initiates explicitly (e.g. `fetch()` + `showSaveDialog`).
Downloads triggered by navigation or a `Content-Disposition: attachment` header
inside a tab webview cannot be intercepted until native child-webview support is
wired (see `webview-spike-gaps.md` GAP-1).

**Mitigation path:**  
Wire `tauri::WebviewWindow`-level download events once native child webviews are
used.  The `download-info` Tauri event shape already mirrors the Electron IPC
payload so the renderer-side `onDownloadInfo` wiring requires no change.

---

## Cluster: Credentials

### FC-GAP-2 - Secure credential storage not implemented

**Electron behaviour:**  
`main/keychainService.js` uses `electron.safeStorage.encryptString()` to encrypt
the credential blob with a key stored in the OS keychain (Keychain on macOS,
DPAPI on Windows, libsecret on Linux).

**Tauri prototype:**  
`credential_store_*` command signatures exist, but every command fails closed.
The prototype does not persist passwords until an OS-backed secret store is
wired.

**Risk:** Any fallback that writes passwords to JSON would be readable by any
process running as the same OS user. The current prototype intentionally avoids
that.

**Mitigation path:**  
Implement the commands with one of:
- [`tauri-plugin-stronghold`](https://github.com/tauri-apps/tauri-plugin-stronghold) - IOTA Stronghold vault; cross-platform.
- [`keyring`](https://crates.io/crates/keyring) crate - thin OS keychain wrapper; closest to safeStorage semantics.

The `Credential` struct and all four `credential_store_*` command signatures are
stable and will not need to change when the storage back-end is swapped.

---

## Cluster: Internal protocol (min://)

### FC-GAP-3 - URI-scheme not registered; assets served via Tauri asset server

**Electron behaviour:**  
`main/minInternalProtocol.js` registers the `min` scheme as privileged and
handles `min://app/<path>` requests by serving files from the app bundle
directory, with a path-traversal check.

**Tauri prototype:**  
`resolve_min_url()` performs the same traversal check and returns the local path,
but the `min://` scheme is not registered in Tauri.  Min pages that construct
`min://` URLs (e.g. the PDF viewer, reader pages) must use the equivalent Tauri
asset-server URL instead.

**Mitigation path:**  
1. Add `"customProtocol": { "name": "min", "schemes": ["min"] }` to
   `tauri.conf.json` capabilities (Tauri v2 syntax TBC with schema).
2. Register the handler in `lib.rs::run()` via:
   ```rust
   .register_uri_scheme_protocol("min", |ctx, request| { ... })
   ```
3. Update CSP to allow `min:` sources alongside the existing `tauri://` origin.

The `resolve_min_url` command can then be retired or kept as a utility.

---

## Cluster: Menus and context menus

### FC-GAP-4 - No native context-menu popup

**Electron behaviour:**  
`main/remoteMenu.js` handles `ipc.on('open-context-menu', ...)` by constructing
a native `Menu` and calling `menu.popup({ x, y })`.  The renderer receives
`context-menu-item-selected` and `context-menu-will-close` IPC events.

**Tauri prototype:**  
`open_context_menu` emits a `context-menu-open` Tauri event to the frontend.
A frontend JS handler must render a fallback menu (positioned at `x, y`) and
call `contextMenuItemSelected` / `contextMenuWillClose` when appropriate.

**Mitigation path:**  
Add [`tauri-plugin-context-menu`](https://github.com/c2r0b/tauri-plugin-context-menu)
to `Cargo.toml` (note: community crate, not Tauri-official).  Linux support is
partial as of 2026.  Alternatively, use `tauri::menu::Menu` for the app menu bar
and accept JS fallback for context menus on Linux.

### FC-GAP-5 - App menu not yet wired

**Electron behaviour:**  
`main/menu.js` builds a full native application menu with keyboard accelerators,
focus-mode toggle, and locale-aware labels.

**Tauri prototype:**  
No app menu is registered.  Tauri v2 provides `tauri::menu::Menu` and
`tauri::menu::MenuBuilder`; wiring it is a separate task that is in scope for the
menus cluster but deferred to avoid coupling with the accelerator / locale
subsystems.

---

## Cluster: Reader / PDF paths

### FC-GAP-6 - No Content-Type interception for automatic PDF detection

**Electron behaviour:**  
`main/download.js` `listenForDownloadHeaders()` intercepts
`webRequest.onHeadersReceived` for all main-frame navigations and emits
`openPDF` to the window when the response is `application/pdf` (and not a
Content-Disposition attachment).

**Tauri prototype:**  
`open_pdf` emits the `open-pdf` Tauri event only when called explicitly by the
renderer.  Automatic interception of PDF responses in tab webviews is not
available without native child-webview support (see `webview-spike-gaps.md`
GAP-1).

**Mitigation path:**  
Wire a per-webview navigation event listener after native child webviews are
implemented.  The `open-pdf` event shape is already stable.

### FC-GAP-7 - Reader pages require app-bundle path mapping

**Electron behaviour:**  
Reader pages are loaded via `min://app/reader/<file>` which is resolved by the
internal protocol handler.  The preload script can access page DOM for reader
detection.

**Tauri prototype:**  
`get_reader_url()` returns a relative path (`reader/<file>`) that is resolved
against the Tauri asset server root.  Cross-origin reader interception requires
the preload / content-script infrastructure that is a separate gap
(see `webview-spike-gaps.md` GAP-3).

---

## Summary table

| Gap ID | Cluster | Severity | Mitigation |
|---|---|---|---|
| FC-GAP-1 | Downloads | High | Requires native child-webview session hooks |
| FC-GAP-2 | Credentials | High | Replace with tauri-plugin-stronghold or keyring |
| FC-GAP-3 | Internal protocol | Medium | register_uri_scheme_protocol + CSP update |
| FC-GAP-4 | Menus | Medium | tauri-plugin-context-menu or JS fallback |
| FC-GAP-5 | Menus | Low | tauri::menu::MenuBuilder wiring |
| FC-GAP-6 | Reader/PDF | High | Requires native child-webview webRequest hook |
| FC-GAP-7 | Reader/PDF | Low | Resolves after preload/content-script work |
