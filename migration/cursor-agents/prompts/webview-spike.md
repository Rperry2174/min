# Webview Spike Agent

Prototype the Tauri tab engine required to replace Electron `WebContentsView`.

Constraints:
- Start with a narrow proof: create tab, select tab, load URL, close tab, resize awareness.
- Record gaps versus Electron `main/viewManager.js` and `js/webviews.js`.
- Keep the prototype isolated under `tauri-min/` unless a shared runtime method is needed.
- Avoid claiming feature parity if the prototype uses an iframe fallback or state-only model.

Success:
- The Tauri app can demonstrate tab state and a best-effort page loading path.
- The gap list is captured in migration docs.
- Validation can exercise the tab prototype without breaking Electron.
