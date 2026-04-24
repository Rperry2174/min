# Webview Spike - Gap Analysis

**Branch:** `cursor/tauri-webview-spike`
**Date:** 2026-04-24
**Compared against:** `main/viewManager.js` + `js/webviews.js` (Min Electron)

This document records every capability delta between the Tauri tab-engine
prototype and the Electron `WebContentsView` model. It is the source of truth
for planning the next migration phase and for the `migration_features()` Rust
command that surfaces status in the UI.

## 1. What The Prototype Covers

The spike proves the narrow success criteria listed in the task:

| Operation | Electron IPC | Tauri prototype | Notes |
|---|---|---|---|
| Create tab | `ipc createView` + `loadURLInView` | `create_tab` command + `<iframe src>` | State-only + iframe |
| Select tab | `ipc setView` | `select_tab` command + swap `iframe.src` | iframe fallback |
| Load URL | `ipc loadURLInView` | `load_url_in_tab` command + `iframe.src` | iframe fallback |
| Close tab | `ipc destroyView` | `close_tab` command | State-only |
| Resize awareness | `ipc setBounds` | `set_tab_bounds` command + window `resize` listener | CSS-pixel bounds stored |
| Load finish callback | `view-event did-finish-load` | `tab_did_finish_load` command called from iframe `onload` | Same-origin only |
| Tab events | `app.emit('tab-event', ...)` | Tauri `app.emit('tab-event', ...)` + JS `listen()` | Works; cross-origin events are blocked |

The prototype is not claiming feature parity. The iframe fallback is an
explicitly labelled stop-gap.

## 2. Critical Gaps

### GAP-1 - No Native Per-Tab Webview Process

Electron `WebContentsView` creates a real Chromium renderer process per tab.
Each tab runs isolated JS, has its own network stack, devtools, and can be
detached from any window.

The Tauri prototype uses a single `<iframe>` element inside the main window
webview. All tabs share one renderer process.

Impact: process isolation, crash recovery, per-tab devtools, and audio-process
routing are not achievable without native child webviews.

Tauri path forward: Tauri v2 has `WebviewWindow` for a top-level window per tab
and Rust-side child webview APIs for embedding child webviews at arbitrary
bounds inside a `Window`. `Window::add_child` maps most closely to
`WebContentsView`. This is the production replacement target; it is not yet
used in this prototype.

### GAP-2 - iframe Sandbox Restrictions

The `<iframe sandbox>` attribute and CSP `frame-src` rule block many real-world
pages:

- Pages that set `X-Frame-Options: DENY` or `SAMEORIGIN` refuse to load.
- Pages that require `allow-popups-to-escape-sandbox` or `allow-top-navigation`
  need relaxed sandbox attributes which reduce isolation guarantees.
- `https://example.com` loads fine; most production web pages will not.

Electron `WebContentsView` has no frame-ancestor restrictions because it is a
native OS-level embedding, not an `<iframe>`.

### GAP-3 - No Preload Script Or Content Isolation

Electron passes `dist/preload.js` into every tab page. This is the mechanism for
`webviews.bindIPC`, settings broadcast, scroll tracking, password fill, reader
detection, and site-unbreak logic.

The iframe prototype has no preload capability. `postMessage` could bridge some
same-origin content, but cannot cover cross-origin pages.

### GAP-4 - No Per-Tab Session Or Partition

Electron private tabs use a dedicated in-memory partition. The Tauri prototype
shares the main webview session and cookie store.

### GAP-5 - No capturePage Or Screenshot API

Electron `view.webContents.capturePage()` provides tab-thumbnail images. The
prototype has no equivalent until native child webviews are wired.

### GAP-6 - No History Or Navigation API

Electron exposes navigation history, back, forward, and offset navigation. The
prototype currently replaces the selected URL without a history stack.

### GAP-7 - No Audio Mute Or Media Session

Electron uses `webContents.setAudioMuted()` and `audio-state-changed`. The
prototype does not implement this yet.

### GAP-8 - No External Protocol Handler

Electron intercepts navigation to external protocols such as `mailto:` and
`slack:`. The iframe prototype has no per-navigation hook for that behavior.

### GAP-9 - No Popup Policy

Electron `setWindowOpenHandler` controls whether `window.open()` becomes a new
tab or popup. The iframe prototype either opens outside the app or is blocked by
the sandbox.

### GAP-10 - No Login Prompt

Electron listens for `webContents` `login` events for HTTP Basic Auth. The
prototype has no equivalent hook.

## 3. Low-Risk Gaps

| Gap | Effort | Notes |
|---|---|---|
| Tab title from page | Low | Use `iframe.contentDocument.title` for same-origin pages; emit a Tauri event to Rust. Already partially wired in `tab_did_finish_load`. |
| Bounds persistence | Low | `set_tab_bounds` / `get_tab_bounds` commands exist; integrate with window `resize` and sidebar margin changes. |
| Session restore | Medium | `TabStore` survives the process but not across app restarts. Persisting to `settings.json` or a separate file would close this gap. |
| Navigation URL display | Low | `load_url_in_tab` updates the stored URL; the address bar reflects it. Cross-origin final URL is unavailable from the iframe. |

## 4. Recommended Next Step

Replace the `<iframe>` with a Tauri child `Webview` embedded at the computed
bounds returned by `get_tab_bounds`. The Rust side already stores bounds per
tab; the missing piece is calling a new native-tab command and tracking the
resulting webview ID. This closes GAP-1 through GAP-5 and enables subsequent
migration work on preload scripts and partition isolation.

Reference: [Tauri v2 multi-webview docs](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/)
