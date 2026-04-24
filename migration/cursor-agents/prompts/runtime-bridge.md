# Runtime Bridge Agent

Introduce a runtime abstraction that lets existing renderer code gradually move away from direct Electron globals.

Constraints:
- Electron behavior must remain unchanged.
- Keep existing `window.electron`, `window.fs`, and `window.ipc` exports until call sites are migrated.
- Prefer a small `minRuntime` API with explicit methods for IPC, filesystem, dialogs, shell, settings, and window controls.
- Do not broaden privileges in Tauri capabilities without documenting why.

Success:
- Electron has a runtime implementation backed by existing Electron APIs.
- Tauri has a runtime implementation backed by `@tauri-apps/api` and commands.
- New code can use `window.minRuntime` without knowing the host runtime.
