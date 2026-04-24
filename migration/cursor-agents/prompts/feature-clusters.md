# Feature Clusters Agent

Migrate native feature clusters behind the runtime bridge.

Feature clusters:
- Settings persistence
- Window controls
- Dialogs and shell open/show operations
- Downloads
- Credentials
- Internal protocol
- Menus and context menus
- Reader/PDF paths

Constraints:
- Keep feature work scoped and mergeable.
- Preserve Electron behavior.
- Prefer Tauri commands and plugins over frontend filesystem access.
- Record unsupported parity gaps rather than hiding them.

Success:
- Feature status is visible in the Tauri app.
- Each migrated cluster has a validation path.
- Electron build and lint gates still pass when dependencies are installed.
