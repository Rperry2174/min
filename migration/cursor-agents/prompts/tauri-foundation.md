# Tauri Foundation Agent

Create or improve the no-op Tauri v2 app under `tauri-min/`.

Constraints:
- Do not modify the existing Electron app except for root package scripts that call the Tauri app.
- Keep the app runnable without a frontend framework.
- Add Rust commands only when they support the migration scaffold.
- Validate with `npm run tauri:check` when dependencies and Rust are available.

Success:
- `tauri-min/` contains a coherent Tauri v2 project.
- The root repo has side-by-side Electron and Tauri scripts.
- The Tauri app shows its migration status and can call at least one Rust command.
