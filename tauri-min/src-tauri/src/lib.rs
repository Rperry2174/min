use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

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

/// In-memory download registry.
/// GAP: Tauri v2 has no session.will-download equivalent.  Downloads initiated
/// from a child webview cannot be intercepted here until native child-webview
/// support is wired.  Renderer-side file-save calls (via show_save_dialog +
/// HTTP fetch) can be tracked through this registry instead.
#[derive(Default)]
struct DownloadState {
    store: Mutex<DownloadStore>,
}

#[derive(Default)]
struct DownloadStore {
    next_id: u64,
    items: Vec<DownloadItem>,
}

/// File-backed credential store protected by the OS keychain is a known gap.
/// For the migration prototype we store credentials in a plain JSON file in
/// app-data so that the API surface is exercisable.
/// GAP: Electron safeStorage encrypts the credential blob with an OS keychain
/// key.  The Tauri prototype stores credentials in plain JSON.  Replace with
/// tauri-plugin-stronghold or the `keyring` crate before shipping.
#[derive(Default)]
struct CredentialState;

/// Context-menu event bus.
/// GAP: Tauri v2 does not have a first-party context-menu plugin equivalent to
/// Electron's Menu.popup().  This state bus lets the frontend register context
/// menus and receive back click results via Tauri events.  A full native
/// context-menu implementation requires the community tauri-plugin-context-menu
/// crate (not yet pulled in) or manual window-level context handling.
#[derive(Default)]
struct MenuState {
    store: Mutex<MenuStore>,
}

#[derive(Default)]
struct MenuStore {
    next_menu_id: u64,
}

// ---------------------------------------------------------------------------
// Serializable types
// ---------------------------------------------------------------------------

/// Bounds for a tab's viewport region (mirrors Electron setBounds / getViewBounds).
/// All values are in logical (CSS) pixels.
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
    loading: bool,
    bounds: TabBounds,
}

/// Event payload emitted to the frontend when tab state changes.
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

/// Options for showOpenDialog.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenDialogOptions {
    title: Option<String>,
    default_path: Option<String>,
    multiple: Option<bool>,
    directory: Option<bool>,
    filters: Option<Vec<DialogFilter>>,
}

/// Options for showSaveDialog.
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

// Download types

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum DownloadStatus {
    Progressing,
    Completed,
    Cancelled,
    Interrupted,
}

/// Mirrors the Electron download-info IPC payload shape.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct DownloadItem {
    id: u64,
    path: String,
    name: String,
    status: DownloadStatus,
    received_bytes: u64,
    total_bytes: u64,
}

/// Payload for the start_download command (renderer-initiated download).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDownloadRequest {
    /// Source URL — stored for audit/display but not used by the Rust layer.
    #[allow(dead_code)]
    url: String,
    save_path: String,
    name: Option<String>,
}

// Credential types

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Credential {
    domain: String,
    username: String,
    password: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CredentialStore {
    version: u32,
    credentials: Vec<Credential>,
}

impl Default for CredentialStore {
    fn default() -> Self {
        CredentialStore {
            version: 1,
            credentials: Vec::new(),
        }
    }
}

// Menu/context-menu types

/// A single item in a context-menu template (mirrors Electron MenuItem shape
/// for the fields the minRuntime bridge needs).
#[derive(Clone, Debug, Serialize, Deserialize)]
struct MenuItemTemplate {
    id: String,
    label: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    enabled: Option<bool>,
    checked: Option<bool>,
    submenu: Option<Vec<MenuItemTemplate>>,
}

/// Request payload from the renderer to open a context menu.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenContextMenuRequest {
    template: Vec<Vec<MenuItemTemplate>>,
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
struct ContextMenuResult {
    menu_id: u64,
}

// PDF / reader types

/// Request from the renderer to open a URL in the PDF viewer.
/// Mirrors the Electron sendIPCToWindow(sourceWindow, 'openPDF', ...) payload.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenPdfRequest {
    url: String,
    tab_id: Option<u64>,
}

/// Result of resolving a min:// app URL to a local file path.
#[derive(Serialize)]
struct ResolvedAppUrl {
    original: String,
    local_path: String,
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

fn credential_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    Ok(app_data_dir.join("passwordStore.json"))
}

fn read_credential_file(app: &tauri::AppHandle) -> Result<CredentialStore, String> {
    let file_path = credential_file_path(app)?;
    if !file_path.exists() {
        return Ok(CredentialStore::default());
    }
    let contents = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&contents).map_err(|e| e.to_string())
}

fn write_credential_file(app: &tauri::AppHandle, store: &CredentialStore) -> Result<(), String> {
    let file_path = credential_file_path(app)?;
    let contents = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(file_path, contents).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commands: app info
// ---------------------------------------------------------------------------

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        product_name: "Min Tauri",
        version: env!("CARGO_PKG_VERSION"),
        runtime: "tauri",
        migration_phase: "feature-clusters",
    }
}

// ---------------------------------------------------------------------------
// Commands: settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Commands: filesystem
//
// Intentionally restricted to text (UTF-8) files to keep the surface minimal.
// ---------------------------------------------------------------------------

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commands: native dialogs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Commands: shell / opener
// ---------------------------------------------------------------------------

#[tauri::command]
fn show_item_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
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

// ---------------------------------------------------------------------------
// Commands: window controls
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Commands: tab management (spike)
// ---------------------------------------------------------------------------

/// Create a new tab and immediately select it.
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

/// Select a tab by id.
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

// ---------------------------------------------------------------------------
// Commands: downloads
//
// GAP: Electron session.will-download intercepts all HTTP downloads initiated
// by any WebContentsView (tab).  Tauri v2 has no equivalent session hook.
// Renderer-initiated downloads that the frontend triggers explicitly (e.g. via
// a save-as flow) can be tracked here.  Downloads triggered by navigation or
// Content-Disposition headers in tab webviews are a known parity gap until
// native child-webview support lands.
// ---------------------------------------------------------------------------

/// Begin tracking a renderer-initiated download.
/// The renderer is responsible for performing the actual HTTP transfer (e.g.
/// via fetch + showSaveDialog) and calling update_download / finish_download.
#[tauri::command]
fn start_download(
    app: tauri::AppHandle,
    state: tauri::State<DownloadState>,
    request: StartDownloadRequest,
) -> Result<DownloadItem, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.next_id += 1;
    let id = store.next_id;

    let name = request
        .name
        .unwrap_or_else(|| {
            std::path::Path::new(&request.save_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("download")
                .to_string()
        });

    let item = DownloadItem {
        id,
        path: request.save_path.clone(),
        name: name.clone(),
        status: DownloadStatus::Progressing,
        received_bytes: 0,
        total_bytes: 0,
    };
    store.items.push(item.clone());

    let _ = app.emit("download-info", &item);
    Ok(item)
}

/// Update progress for an in-flight download.
#[tauri::command]
fn update_download(
    app: tauri::AppHandle,
    state: tauri::State<DownloadState>,
    id: u64,
    received_bytes: u64,
    total_bytes: u64,
) -> Result<DownloadItem, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;

    let item = store
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("unknown download id: {id}"))?;

    item.received_bytes = received_bytes;
    item.total_bytes = total_bytes;
    item.status = DownloadStatus::Progressing;

    let updated = item.clone();
    let _ = app.emit("download-info", &updated);
    Ok(updated)
}

/// Mark a download as complete, cancelled, or interrupted.
#[tauri::command]
fn finish_download(
    app: tauri::AppHandle,
    state: tauri::State<DownloadState>,
    id: u64,
    status: DownloadStatus,
) -> Result<DownloadItem, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;

    let item = store
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("unknown download id: {id}"))?;

    item.status = status;
    if item.status == DownloadStatus::Completed {
        item.received_bytes = item.total_bytes;
    }

    let updated = item.clone();
    let _ = app.emit("download-info", &updated);
    Ok(updated)
}

/// Cancel an in-progress download.
/// The renderer is responsible for aborting the transfer; this command updates
/// state and emits the event to other listeners.
#[tauri::command]
fn cancel_download(
    app: tauri::AppHandle,
    state: tauri::State<DownloadState>,
    id: u64,
) -> Result<DownloadItem, String> {
    finish_download(app, state, id, DownloadStatus::Cancelled)
}

/// Return all tracked download items.
#[tauri::command]
fn list_downloads(state: tauri::State<DownloadState>) -> Result<Vec<DownloadItem>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.items.clone())
}

// ---------------------------------------------------------------------------
// Commands: credentials
//
// GAP: Electron safeStorage encrypts with an OS keychain key.  This prototype
// stores credentials as plain JSON in the app-data directory.  Replace with
// tauri-plugin-stronghold or the `keyring` crate for production.
// ---------------------------------------------------------------------------

#[tauri::command]
fn credential_store_get_credentials(app: tauri::AppHandle) -> Result<Vec<Credential>, String> {
    let store = read_credential_file(&app)?;
    Ok(store.credentials)
}

#[tauri::command]
fn credential_store_set_password(
    app: tauri::AppHandle,
    account: Credential,
) -> Result<(), String> {
    let mut store = read_credential_file(&app)?;

    // remove duplicates (same domain + username)
    store.credentials.retain(|c| {
        !(c.domain == account.domain && c.username == account.username)
    });
    store.credentials.push(account);
    write_credential_file(&app, &store)
}

#[tauri::command]
fn credential_store_set_password_bulk(
    app: tauri::AppHandle,
    accounts: Vec<Credential>,
) -> Result<(), String> {
    let mut store = read_credential_file(&app)?;
    store.credentials = accounts;
    write_credential_file(&app, &store)
}

#[tauri::command]
fn credential_store_delete_password(
    app: tauri::AppHandle,
    account: Credential,
) -> Result<(), String> {
    let mut store = read_credential_file(&app)?;
    store.credentials.retain(|c| {
        !(c.domain == account.domain && c.username == account.username)
    });
    write_credential_file(&app, &store)
}

// ---------------------------------------------------------------------------
// Commands: internal protocol (min://)
//
// Electron registers a 'min' protocol scheme that resolves min://app/<path>
// URLs to local files under the app bundle directory.  In Tauri v2 the same
// isolation is achieved by serving the frontend via the built-in asset protocol
// (the default tauri:// or https://tauri.localhost).
//
// This command provides a URL-to-local-path resolver so that renderer code that
// constructs min:// URLs (e.g. for the PDF viewer or reader pages) can obtain
// the equivalent local path and load it through the Tauri asset server instead.
//
// GAP: Dynamic registration of a custom URI scheme in Tauri v2 requires adding
// the scheme to tauri.conf.json and implementing a protocol handler in Rust via
// tauri::Builder::register_uri_scheme_protocol().  That full wiring is tracked
// as a follow-on task.  For now the resolver gives the renderer a migration path.
// ---------------------------------------------------------------------------

/// Resolve a min://app/<path> URL to the local filesystem path.
///
/// Security: path traversal is checked with the same logic as Electron's
/// minInternalProtocol.js – the resolved path must be a child of the app
/// resource directory.
#[tauri::command]
fn resolve_min_url(app: tauri::AppHandle, url: String) -> Result<ResolvedAppUrl, String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;

    if parsed.scheme() != "min" {
        return Err(format!("scheme must be 'min', got '{}'", parsed.scheme()));
    }

    let host = parsed.host_str().unwrap_or("");
    if host != "app" {
        return Err(format!("host must be 'app', got '{host}'"));
    }

    let mut pathname = parsed.path().to_string();
    if pathname.starts_with('/') {
        pathname = pathname[1..].to_string();
    }

    // Resolve relative to the Tauri resource directory.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?;

    let candidate = resource_dir.join(&pathname);
    let canonical = candidate
        .canonicalize()
        .unwrap_or(candidate.clone());
    let resource_canonical = resource_dir
        .canonicalize()
        .unwrap_or(resource_dir.clone());

    // Path traversal check (mirrors Electron implementation).
    if !canonical.starts_with(&resource_canonical) {
        return Err("path traversal detected".to_string());
    }

    Ok(ResolvedAppUrl {
        original: url,
        local_path: canonical.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// Commands: menus and context menus
//
// GAP: Tauri v2 does not ship a first-party context-menu plugin that maps to
// Electron's Menu.popup().  The community `tauri-plugin-context-menu` crate
// provides native context menus on macOS and Windows; Linux support is partial.
// It is not pulled in here to keep the crate dependency surface small.
//
// The commands below provide the renderer-side contract so that call sites can
// be updated to use window.minRuntime.openContextMenu() rather than going
// through Electron IPC.  When the native plugin is ready the Rust implementation
// swaps in without changing the JS surface.
//
// The current implementation emits a 'context-menu-open' event back to the
// renderer so a JS-side fallback can render the menu (matching the tauri-min
// web shell's single-webview constraint).
// ---------------------------------------------------------------------------

/// Open a context menu.  Currently emits a Tauri event to the frontend which
/// is responsible for rendering a fallback JS menu.  Replace the body with a
/// native menu plugin call when available.
#[tauri::command]
fn open_context_menu(
    app: tauri::AppHandle,
    state: tauri::State<MenuState>,
    request: OpenContextMenuRequest,
) -> Result<ContextMenuResult, String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.next_menu_id += 1;
    let menu_id = store.next_menu_id;

    let _ = app.emit(
        "context-menu-open",
        serde_json::json!({
            "menuId": menu_id,
            "template": request.template,
            "x": request.x,
            "y": request.y,
        }),
    );

    Ok(ContextMenuResult { menu_id })
}

/// Notify Rust that the user selected an item from the JS-rendered context menu.
/// This mirrors the Electron 'context-menu-item-selected' IPC message so that
/// listeners registered through minRuntime.on() can be notified.
#[tauri::command]
fn context_menu_item_selected(
    app: tauri::AppHandle,
    menu_id: u64,
    item_id: String,
) -> Result<(), String> {
    let _ = app.emit(
        "context-menu-item-selected",
        serde_json::json!({ "menuId": menu_id, "itemId": item_id }),
    );
    Ok(())
}

/// Notify Rust that the context menu was dismissed without a selection.
#[tauri::command]
fn context_menu_will_close(app: tauri::AppHandle, menu_id: u64) -> Result<(), String> {
    let _ = app.emit(
        "context-menu-will-close",
        serde_json::json!({ "menuId": menu_id }),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands: reader / PDF paths
//
// Electron's download.js intercepts Content-Type: application/pdf responses
// and emits an 'openPDF' IPC message to the window.  The reader view is loaded
// via min://app/reader/ URLs resolved by the internal protocol.
//
// In Tauri the PDF viewer and reader pages are accessed through the Tauri asset
// server.  The commands below let the renderer trigger PDF / reader navigation
// in a way that can be intercepted by the shell.
// ---------------------------------------------------------------------------

/// Signal that a PDF URL should be opened in the PDF viewer page.
/// Emits a 'open-pdf' Tauri event to the frontend shell; the shell is
/// responsible for creating/selecting a tab and loading the viewer URL.
/// Mirrors: sendIPCToWindow(sourceWindow, 'openPDF', { url, tabId })
#[tauri::command]
fn open_pdf(app: tauri::AppHandle, request: OpenPdfRequest) -> Result<(), String> {
    let _ = app.emit(
        "open-pdf",
        serde_json::json!({
            "url": request.url,
            "tabId": request.tab_id,
        }),
    );
    Ok(())
}

/// Return the Tauri-relative URL for the reader view page.
/// Callers that previously built a min://app/reader/ URL should use this to
/// obtain the equivalent URL for the current runtime.
#[tauri::command]
fn get_reader_url(path: Option<String>) -> String {
    let suffix = path.unwrap_or_default();
    // In the Tauri dev server / asset server the frontend root is served from
    // tauri://localhost (desktop) or the configured frontendDist.
    // Reader assets live in reader/ relative to the web root.
    format!("reader/{suffix}")
}

/// Return the Tauri-relative URL for the PDF viewer page.
#[tauri::command]
fn get_pdf_viewer_url(pdf_url: Option<String>) -> String {
    match pdf_url {
        Some(u) => format!("pages/pdfViewer/index.html?url={}", u),
        None => "pages/pdfViewer/index.html".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Commands: migration introspection
// ---------------------------------------------------------------------------

#[tauri::command]
fn migration_features() -> Vec<MigrationFeature> {
    vec![
        MigrationFeature {
            id: "settings",
            label: "Settings persistence",
            status: "complete",
            notes: "read_setting / write_setting persist JSON in the Tauri app-data directory.",
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
            label: "Shell integration (open/show)",
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
            notes: "create_tab / select_tab / load_url_in_tab / close_tab / set_tab_bounds implemented. Content uses iframe fallback; native per-tab webview is the key parity gap. See docs/tauri-migration/webview-spike-gaps.md.",
        },
        MigrationFeature {
            id: "downloads",
            label: "Downloads",
            status: "partial",
            notes: "start_download / update_download / finish_download / cancel_download track renderer-initiated downloads via in-memory state + Tauri events. GAP: session.will-download interception for navigation-triggered downloads is not available without native child-webview support.",
        },
        MigrationFeature {
            id: "credentials",
            label: "Credentials / password store",
            status: "partial",
            notes: "credential_store_get_credentials / set_password / set_password_bulk / delete_password persist to a plain JSON file. GAP: Electron safeStorage encrypts with an OS keychain key; replace with tauri-plugin-stronghold or the keyring crate before shipping.",
        },
        MigrationFeature {
            id: "internal-protocol",
            label: "Internal protocol (min://)",
            status: "partial",
            notes: "resolve_min_url() maps min://app/<path> to a local file path with the same traversal check as Electron's minInternalProtocol.js. GAP: full URI-scheme registration (tauri::Builder::register_uri_scheme_protocol) and CSP update are required so that min:// URLs load natively.",
        },
        MigrationFeature {
            id: "menus",
            label: "Menus and context menus",
            status: "partial",
            notes: "open_context_menu / context_menu_item_selected / context_menu_will_close provide the IPC contract. GAP: native popup rendering requires the community tauri-plugin-context-menu crate or tauri::Menu API; current implementation falls back to a frontend JS menu via Tauri events.",
        },
        MigrationFeature {
            id: "reader-pdf",
            label: "Reader / PDF paths",
            status: "partial",
            notes: "open_pdf emits an open-pdf event to the shell. get_reader_url / get_pdf_viewer_url return Tauri-relative paths. GAP: Content-Type interception (Electron webRequest.onHeadersReceived) is not available without native child-webview support.",
        },
    ]
}

// ---------------------------------------------------------------------------
// App entry point
// ---------------------------------------------------------------------------

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
        .manage(DownloadState::default())
        .manage(CredentialState)
        .manage(MenuState::default())
        .invoke_handler(tauri::generate_handler![
            // app
            app_info,
            // settings
            read_setting,
            write_setting,
            // filesystem
            read_text_file,
            write_text_file,
            // dialogs
            show_open_dialog,
            show_save_dialog,
            // shell
            show_item_in_folder,
            open_path,
            // window controls
            minimize_window,
            toggle_maximize_window,
            close_window,
            // tab management
            create_tab,
            select_tab,
            load_url_in_tab,
            tab_did_finish_load,
            set_tab_bounds,
            get_tab_bounds,
            list_tabs,
            close_tab,
            // downloads
            start_download,
            update_download,
            finish_download,
            cancel_download,
            list_downloads,
            // credentials
            credential_store_get_credentials,
            credential_store_set_password,
            credential_store_set_password_bulk,
            credential_store_delete_password,
            // internal protocol
            resolve_min_url,
            // menus
            open_context_menu,
            context_menu_item_selected,
            context_menu_will_close,
            // reader / PDF
            open_pdf,
            get_reader_url,
            get_pdf_viewer_url,
            // migration introspection
            migration_features,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Min Tauri migration app");
}
