use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

// State types

#[derive(Default)]
struct TabState {
    store: Mutex<TabStore>,
}

#[derive(Default)]
struct TabStore {
    next_id: u64,
    selected_id: Option<u64>,
    tabs: Vec<PrototypeTab>,
}

// Serializable response types

/// Bounds for a tab's viewport region (mirrors Electron setBounds / getViewBounds).
/// All values are in logical (CSS) pixels; the Tauri frontend translates to physical
/// pixels when needed.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct TabBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
struct PrototypeTab {
    id: u64,
    url: String,
    title: String,
    selected: bool,
    /// Load-state mirrors the subset of Electron did-start-loading / did-finish-load
    /// events that callers need for UI feedback.  The Tauri prototype tracks this in
    /// state rather than via real webview callbacks (see gaps doc).
    loading: bool,
    /// Cached bounds so the frontend can restore position on re-select.
    bounds: TabBounds,
}

/// Event payload emitted to the frontend when tab state changes.
/// Mirrors the Electron `view-event` IPC channel shape enough for the
/// migration bridge to forward events without knowing their semantics.
#[derive(Clone, Serialize)]
struct TabEvent {
    tab_id: u64,
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct AppInfo {
    product_name: &'static str,
    version: &'static str,
    runtime: &'static str,
    migration_phase: &'static str,
}

#[derive(Serialize)]
struct SettingValue {
    key: String,
    value: Option<String>,
}

#[derive(Serialize)]
struct MigrationFeature {
    id: &'static str,
    label: &'static str,
    status: &'static str,
    notes: &'static str,
}

// Dialog option types

/// A subset of the options accepted by both showOpenDialog and showSaveDialog.
/// Only the fields needed for the minRuntime bridge surface are included; the
/// full dialog plugin API can be used directly from Rust when richer control is
/// required.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDialogOptions {
    title: Option<String>,
    default_path: Option<String>,
    multiple: Option<bool>,
    directory: Option<bool>,
    filters: Option<Vec<DialogFilter>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogOptions {
    title: Option<String>,
    default_path: Option<String>,
    filters: Option<Vec<DialogFilter>>,
}

#[derive(Debug, Deserialize)]
struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

// Settings helpers

fn settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

fn read_settings_file(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let file_path = settings_file_path(app)?;
    if !file_path.exists() {
        return Ok(HashMap::new());
    }
    let contents = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&contents).map_err(|e| e.to_string())
}

fn write_settings_file(
    app: &tauri::AppHandle,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    let file_path = settings_file_path(app)?;
    let contents = serde_json::to_string_pretty(values).map_err(|e| e.to_string())?;
    fs::write(file_path, contents).map_err(|e| e.to_string())
}

// Commands: app info

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        product_name: "Min Tauri",
        version: env!("CARGO_PKG_VERSION"),
        runtime: "tauri",
        migration_phase: "side-by-side scaffold",
    }
}

// Commands: settings

#[tauri::command]
fn read_setting(app: tauri::AppHandle, key: String) -> Result<SettingValue, String> {
    let values = read_settings_file(&app)?;
    Ok(SettingValue {
        key: key.clone(),
        value: values.get(&key).cloned(),
    })
}

#[tauri::command]
fn write_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<SettingValue, String> {
    let mut values = read_settings_file(&app)?;
    values.insert(key.clone(), value.clone());
    write_settings_file(&app, &values)?;
    Ok(SettingValue {
        key,
        value: Some(value),
    })
}

// Commands: filesystem
//
// These commands expose plain file read/write for paths that the renderer
// provides.  They are intentionally restricted to text (UTF-8) files to keep
// the surface minimal and auditable.  Binary file access should be implemented
// as a dedicated Rust command with appropriate path validation.

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

// Commands: native dialogs
//
// The dialog plugin is already declared in the capabilities file under
// "dialog:default".  That permission covers both open and save dialogs.
// No additional capability scope is required; the existing "dialog:default"
// entry in capabilities/default.json grants these APIs.

#[tauri::command]
fn show_open_dialog(
    app: tauri::AppHandle,
    options: Option<OpenDialogOptions>,
) -> Result<Vec<String>, String> {
    let opts = options.unwrap_or_default();
    let mut builder = app.dialog().file();

    if let Some(title) = opts.title {
        builder = builder.set_title(title);
    }
    if let Some(default_path) = opts.default_path {
        builder = builder.set_directory(default_path);
    }
    if let Some(filters) = opts.filters {
        for f in &filters {
            let extensions: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&f.name, &extensions);
        }
    }

    let multiple = opts.multiple.unwrap_or(false);
    let directory = opts.directory.unwrap_or(false);

    if directory {
        match builder.blocking_pick_folder() {
            Some(path) => Ok(vec![path.to_string()]),
            None => Ok(vec![]),
        }
    } else if multiple {
        match builder.blocking_pick_files() {
            Some(paths) => Ok(paths.into_iter().map(|p| p.to_string()).collect()),
            None => Ok(vec![]),
        }
    } else {
        match builder.blocking_pick_file() {
            Some(path) => Ok(vec![path.to_string()]),
            None => Ok(vec![]),
        }
    }
}

#[tauri::command]
fn show_save_dialog(
    app: tauri::AppHandle,
    options: Option<SaveDialogOptions>,
) -> Result<Option<String>, String> {
    let opts = options.unwrap_or_default();
    let mut builder = app.dialog().file();

    if let Some(title) = opts.title {
        builder = builder.set_title(title);
    }
    if let Some(default_path) = opts.default_path {
        builder = builder.set_file_name(default_path);
    }
    if let Some(filters) = opts.filters {
        for f in &filters {
            let extensions: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&f.name, &extensions);
        }
    }

    Ok(builder.blocking_save_file().map(|p| p.to_string()))
}

// Commands: shell / opener
//
// The opener plugin is already declared in the capabilities file under
// "opener:default".  No additional capability scope is required.

#[tauri::command]
fn show_item_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Reveal the item's parent directory using the opener plugin's
    // reveal_item_in_dir, which maps to Finder "Show in Finder" / Windows
    // Explorer / the system file manager on Linux.
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

// Commands: window controls

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

// Commands: tab management (spike)
//
// These commands implement the narrow proof: create, select, load URL, close,
// and resize-bounds awareness.  They correspond to the IPC messages handled by
// Electron's viewManager.js: createView, setView, loadURLInView, destroyView,
// and setBounds.
//
// PROTOTYPE LIMITATION: tab content is rendered by an <iframe> in the single
// Tauri webview, not by native per-tab webviews.  See the gap doc for details.

/// Create a new tab and immediately select it.
/// Corresponds to Electron: ipc.on('createView') + ipc.on('loadURLInView')
#[tauri::command]
fn create_tab(
    app: tauri::AppHandle,
    state: tauri::State<TabState>,
    url: String,
    bounds: Option<TabBounds>,
) -> Result<PrototypeTab, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.next_id += 1;
    let id = store.next_id;

    for tab in store.tabs.iter_mut() {
        tab.selected = false;
    }

    let tab = PrototypeTab {
        id,
        url: url.clone(),
        title: url.clone(),
        selected: true,
        loading: true,
        bounds: bounds.unwrap_or_default(),
    };
    store.selected_id = Some(id);
    store.tabs.push(tab.clone());

    // Emit tab-created event so the frontend can react without polling.
    let _ = app.emit(
        "tab-event",
        TabEvent {
            tab_id: id,
            event: "tab-created".to_string(),
            data: None,
        },
    );

    Ok(tab)
}

/// Select a tab by id (show it, deselect others).
/// Corresponds to Electron: ipc.on('setView')
#[tauri::command]
fn select_tab(
    app: tauri::AppHandle,
    state: tauri::State<TabState>,
    id: u64,
) -> Result<Vec<PrototypeTab>, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let mut found = false;

    for tab in store.tabs.iter_mut() {
        tab.selected = tab.id == id;
        found = found || tab.selected;
    }

    if !found {
        return Err(format!("unknown tab id: {id}"));
    }

    store.selected_id = Some(id);

    let _ = app.emit(
        "tab-event",
        TabEvent {
            tab_id: id,
            event: "tab-selected".to_string(),
            data: None,
        },
    );

    Ok(store.tabs.clone())
}

/// Load a URL in an existing tab.
/// Corresponds to Electron: ipc.on('loadURLInView')
#[tauri::command]
fn load_url_in_tab(
    app: tauri::AppHandle,
    state: tauri::State<TabState>,
    id: u64,
    url: String,
) -> Result<PrototypeTab, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;

    let tab = store
        .tabs
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown tab id: {id}"))?;

    tab.url = url.clone();
    tab.title = url.clone();
    tab.loading = true;

    let updated = tab.clone();

    let _ = app.emit(
        "tab-event",
        TabEvent {
            tab_id: id,
            event: "did-start-loading".to_string(),
            data: Some(serde_json::json!({ "url": url })),
        },
    );

    Ok(updated)
}

/// Mark a tab as finished loading (frontend calls this after iframe load event).
/// Corresponds to Electron: view-event did-finish-load
#[tauri::command]
fn tab_did_finish_load(
    app: tauri::AppHandle,
    state: tauri::State<TabState>,
    id: u64,
    final_url: Option<String>,
    title: Option<String>,
) -> Result<PrototypeTab, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;

    let tab = store
        .tabs
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown tab id: {id}"))?;

    tab.loading = false;
    if let Some(u) = final_url {
        tab.url = u;
    }
    if let Some(t) = title {
        tab.title = t;
    }

    let updated = tab.clone();

    let _ = app.emit(
        "tab-event",
        TabEvent {
            tab_id: id,
            event: "did-finish-load".to_string(),
            data: None,
        },
    );

    Ok(updated)
}

/// Update the viewport bounds for a tab.
/// Corresponds to Electron: ipc.on('setBounds')
#[tauri::command]
fn set_tab_bounds(
    state: tauri::State<TabState>,
    id: u64,
    bounds: TabBounds,
) -> Result<PrototypeTab, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;

    let tab = store
        .tabs
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown tab id: {id}"))?;

    tab.bounds = bounds;
    Ok(tab.clone())
}

/// Return the stored bounds for a tab.
#[tauri::command]
fn get_tab_bounds(state: tauri::State<TabState>, id: u64) -> Result<TabBounds, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let tab = store
        .tabs
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("unknown tab id: {id}"))?;
    Ok(tab.bounds.clone())
}

#[tauri::command]
fn list_tabs(state: tauri::State<TabState>) -> Result<Vec<PrototypeTab>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.tabs.clone())
}

/// Close a tab and auto-select the most recent remaining tab.
/// Corresponds to Electron: ipc.on('destroyView')
#[tauri::command]
fn close_tab(
    app: tauri::AppHandle,
    state: tauri::State<TabState>,
    id: u64,
) -> Result<Vec<PrototypeTab>, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.tabs.retain(|tab| tab.id != id);

    if store.selected_id == Some(id) {
        store.selected_id = store.tabs.last().map(|tab| tab.id);
    }

    let selected_id = store.selected_id;
    for tab in store.tabs.iter_mut() {
        tab.selected = Some(tab.id) == selected_id;
    }

    let _ = app.emit(
        "tab-event",
        TabEvent {
            tab_id: id,
            event: "tab-closed".to_string(),
            data: None,
        },
    );

    Ok(store.tabs.clone())
}

// Commands: migration introspection

#[tauri::command]
fn migration_features() -> Vec<MigrationFeature> {
    vec![
        MigrationFeature {
            id: "settings",
            label: "Settings persistence",
            status: "complete",
            notes: "Command-backed bridge persists JSON in the Tauri app-data directory.",
        },
        MigrationFeature {
            id: "window-controls",
            label: "Window controls",
            status: "complete",
            notes: "minimize / toggleMaximize / close backed by tauri::Window APIs.",
        },
        MigrationFeature {
            id: "dialogs",
            label: "Native dialogs",
            status: "complete",
            notes: "showOpenDialog and showSaveDialog backed by tauri-plugin-dialog.",
        },
        MigrationFeature {
            id: "shell",
            label: "Shell integration",
            status: "complete",
            notes: "openPath and showItemInFolder backed by tauri-plugin-opener.",
        },
        MigrationFeature {
            id: "filesystem",
            label: "Filesystem (text files)",
            status: "complete",
            notes: "readTextFile and writeTextFile backed by std::fs; restricted to UTF-8 text.",
        },
        MigrationFeature {
            id: "tabs",
            label: "Tab engine",
            status: "spike",
            notes: "create_tab / select_tab / load_url_in_tab / close_tab / set_tab_bounds implemented. Content rendered via iframe fallback; native per-tab Tauri Webview instances are the key parity gap. See migration/docs/webview-spike-gaps.md.",
        },
        MigrationFeature {
            id: "downloads",
            label: "Downloads",
            status: "planned",
            notes: "Electron session will-download has no direct drop-in replacement.",
        },
        MigrationFeature {
            id: "credentials",
            label: "Credentials",
            status: "planned",
            notes: "Electron safeStorage must move to a Tauri/Rust secret storage implementation.",
        },
    ]
}

// App entry point

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(TabState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_setting,
            write_setting,
            read_text_file,
            write_text_file,
            show_open_dialog,
            show_save_dialog,
            show_item_in_folder,
            open_path,
            minimize_window,
            toggle_maximize_window,
            close_window,
            create_tab,
            select_tab,
            load_url_in_tab,
            tab_did_finish_load,
            set_tab_bounds,
            get_tab_bounds,
            list_tabs,
            close_tab,
            migration_features,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Min Tauri migration app");
}
