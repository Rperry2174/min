# Webview Spike — Gap Analysis

**Branch:** `cursor/tauri-webview-spike`
**Date:** 2026-04-24
**Compared against:** `main/viewManager.js` + `js/webviews.js` (Min Electron)

This document records every capability delta between the Tauri tab-engine
prototype and the Electron `WebContentsView` model.  It is the source of truth
for planning the next migration phase and for the `migration_features()` Rust
command that surfaces status in the UI.

---

## 1. What the prototype covers

The spike proves the narrow success criteria listed in the task:

| Operation | Electron IPC | Tauri prototype | Notes |
|---|---|---|---|
| Create tab | `ipc createView` + `loadURLInView` | `create_tab` command + `<iframe src>` | State-only + iframe |
| Select tab | `ipc setView` | `select_tab` command + swap `iframe.src` | iframe fallback |
| Load URL | `ipc loadURLInView` | `load_url_in_tab` command + `iframe.src` | iframe fallback |
| Close tab | `ipc destroyView` | `close_tab` command | State-only |
| Resize awareness | `ipc setBounds` | `set_tab_bounds` command + window `resize` listener | CSS-pixel bounds stored |
| Load finish callback | `view-event did-finish-load` | `tab_did_finish_load` command (called from iframe onload) | Same-origin only |
| Tab events | `app.emit('tab-event', …)` | Tauri `app.emit('tab-event', …)` + JS `listen()` | Works; cross-origin events are blocked |

The prototype is **not** claiming feature parity.  The iframe fallback is an
explicitly labelled stop-gap.

---

## 2. Critical gaps (blockers for production parity)

### GAP-1 — No native per-tab webview process
**Electron:** `WebContentsView` creates a real Chromium renderer process per
tab.  Each tab runs isolated JS, has its own network stack, devtools, and can be
detached from any window.

**Tauri prototype:** A single `<iframe>` element inside the main window
webview.  All tabs share one renderer process.

**Impact:** Process isolation, crash recovery (`webviews.bindEvent('crashed', …)`),
per-tab devtools, and audio-process routing are not achievable without native
child webviews.

**Tauri path forward:** Tauri v2 has `WebviewWindow` (a top-level window per
tab) and the experimental `Webview` type for embedding child webviews at
arbitrary bounds inside a `Window`.  Using `Window::add_child` / `AppHandle::
new_webview_on_window` maps most closely to `WebContentsView`.  This is the
production replacement target; it is not yet used in this prototype.

---

### GAP-2 — iframe sandbox restrictions
The `<iframe sandbox>` attribute and CSP `frame-src` rule block many real-world
pages:

- Pages that set `X-Frame-Options: DENY` or `SAMEORIGIN` refuse to load.
- Pages that require `allow-popups-to-escape-sandbox` or `allow-top-navigation`
  need relaxed sandbox attributes which reduce isolation guarantees.
- `https://example.com` loads fine; most production-web pages will not.

**Impact:** The prototype is useful for demonstrating mechanics but cannot load
the majority of the web without compromising the sandbox.

**Electron equivalent:** `WebContentsView` has no frame-ancestor restrictions
because it is a native OS-level embedding, not an `<iframe>`.

---

### GAP-3 — No preload script / content isolation
**Electron:** `viewManager.js` passes a `preload` path in `webPreferences`,
injecting `dist/preload.js` into every tab page.  This is the mechanism for:
- `webviews.bindIPC` / `webviews.callAsync` (renderer ↔ page IPC)
- Settings broadcast (`getSettingsData`, `setSetting`)
- Scroll-position tracking (`scroll-position-change`)

**Tauri prototype:** The iframe has no preload capability.  `postMessage` could
bridge some of this for same-origin content but cannot cover cross-origin pages.

---

### GAP-4 — No per-tab session / partition
**Electron:** Private tabs use a dedicated in-memory partition
(`session.fromPartition(tabId)`), ensuring cookies and storage are isolated.

**Tauri prototype:** All iframe content shares the main webview's session/cookie
store.  There is no Tauri API to set per-webview storage partitions from JS
today.

---

### GAP-5 — No capturePage / screenshot API
**Electron:** `view.webContents.capturePage()` provides tab-thumbnail images
used for the placeholder/preview feature in `webviews.js`.

**Tauri prototype:** No equivalent.  A native child webview would expose
`Webview::capture_image()` (available in Tauri v2 via the `tao` backend), but
that API is not wired up.

---

### GAP-6 — No history / navigation API
**Electron:** `webContents.navigationHistory`, `goBack()`, `goToOffset()`,
`canGoToOffset()` are used by `webviews.goBackIgnoringRedirects()` and the
navbar back-button.

**Tauri prototype:** No navigation history is stored.  `loadUrlInTab` replaces
the URL without any history stack.

---

### GAP-7 — No audio mute / media session
**Electron:** `webContents.setAudioMuted()` / `getAudioMuted()` + the
`audio-state-changed` event power `js/tabAudio.js`.

**Tauri prototype:** Not implemented; requires native child webview.

---

### GAP-8 — No external-protocol handler
**Electron:** `viewManager.js` intercepts `did-start-navigation` to detect
non-web protocols (`mailto:`, `slack:`, etc.) and shows a dialog via
`electron.dialog.showMessageBoxSync`.

**Tauri prototype:** `open_path` / `opener` plugin handles shell open, but
there is no per-navigation hook from an iframe to intercept protocol launches.

---

### GAP-9 — No window-open / popup policy
**Electron:** `setWindowOpenHandler` in `viewManager.js` controls whether
`window.open()` creates a new tab (via `view-event new-tab`) or a popup
(`did-create-popup`).

**Tauri prototype:** iframe `window.open()` either opens in a new browser
tab (outside the app) or is blocked by the sandbox.

---

### GAP-10 — No login prompt (HTTP Basic Auth)
**Electron:** `view.webContents.on('login', …)` shows a native credential
dialog.

**Tauri prototype:** No equivalent hook.

---

## 3. Low-risk gaps (solvable without native webviews)

| Gap | Effort | Notes |
|---|---|---|
| Tab title from page | Low | Use `iframe.contentDocument.title` for same-origin pages; emit a Tauri event to Rust. Already partially wired in `tab_did_finish_load`. |
| Bounds persistence | Low | `set_tab_bounds` / `get_tab_bounds` commands exist; integrate with window `resize` and sidebar margin changes. |
| Session restore | Medium | `TabStore` survives the process but not across app restarts.  Persisting to `settings.json` or a separate file would close this gap. |
| Navigation URL display | Low | `load_url_in_tab` updates the stored URL; the address bar reflects it. Cross-origin final URL is unavailable from the iframe. |

---

## 4. Recommended next step

Replace the `<iframe>` with a Tauri `Webview` child embedded at the computed
bounds returned by `get_tab_bounds`.  The Rust side already stores bounds per
tab; the missing piece is calling `window.add_child_webview(url, bounds)` from a
new `create_native_tab` command and tracking the resulting `WebviewId`.  This
closes GAP-1 through GAP-5 and enables subsequent migration work on preload
scripts (GAP-3) and partition isolation (GAP-4).

Reference: [Tauri v2 multi-webview docs](https://v2.tauri.app/reference/javascript/api/namespacedwebviewwindow/)
