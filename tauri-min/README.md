# Min Tauri

This is the side-by-side Tauri migration target for Min.

The current Electron app remains at the repository root. This folder starts as a no-op Tauri shell and progressively gains Min browser functionality behind runtime bridges.

## Commands

From the repository root:

```text
npm run start:electron
npm run start:tauri
npm run tauri:check
```

The Tauri scripts add `$HOME/.cargo/bin` to PATH so a Rust toolchain installed through `rustup` is discoverable.

## Current Scope

- Tauri v2 project scaffold.
- Static web shell without a frontend framework.
- Rust commands for app info, in-memory settings, and prototype tab state.
- Runtime bridge exposed as `window.minRuntime`.

The tab preview currently uses an iframe fallback for demonstration. Native Tauri child webview parity is tracked as the migration spike, because Min's Electron implementation depends heavily on `WebContentsView`.
