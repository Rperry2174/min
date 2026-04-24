# Tauri Webview Spike

Min's Electron tab engine is centered on `WebContentsView`:

- `main/viewManager.js` creates one native content view per tab.
- `js/webviews.js` sends IPC commands such as `createView`, `loadURLInView`, `setView`, and `setBounds`.
- Feature code calls webContents-style methods including navigation, reload, capture, script execution, and audio muting.

## Current Prototype

The Tauri scaffold includes a first tab prototype:

- Rust state commands in `tauri-min/src-tauri/src/lib.rs`:
  - `create_tab`
  - `select_tab`
  - `list_tabs`
  - `close_tab`
- Tauri frontend bridge methods in `tauri-min/web/runtime.js`.
- A visible tab demo in `tauri-min/web/index.html`.

The preview uses an iframe. That is deliberately labeled as a fallback because many arbitrary pages block iframe embedding and it does not match Electron's native per-tab `WebContentsView` semantics.

## Native Parity Gap

The next spike must replace or supplement the iframe preview with Tauri v2 native child webviews. The required parity checklist is:

- Create a native webview per tab.
- Attach/detach a selected webview from the main window.
- Resize the selected webview to match Min's chrome bounds.
- Load arbitrary `http`, `https`, `file`, and internal app URLs.
- Forward navigation and load lifecycle events to the renderer.
- Support basic methods: back, forward, reload, stop, focus, capture, execute script.
- Preserve private tab partition semantics or document an alternative.

Until that checklist is green, feature work should treat the Tauri tab engine as a spike rather than production parity.
