use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

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

#[derive(Clone, Serialize)]
struct PrototypeTab {
    id: u64,
    url: String,
    selected: bool,
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

fn settings_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
    Ok(app_data_dir.join("settings.json"))
}

fn read_settings_file(app: &tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let file_path = settings_file_path(app)?;

    if !file_path.exists() {
        return Ok(HashMap::new());
    }

    let contents = fs::read_to_string(file_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_settings_file(
    app: &tauri::AppHandle,
    values: &HashMap<String, String>,
) -> Result<(), String> {
    let file_path = settings_file_path(app)?;
    let contents = serde_json::to_string_pretty(values).map_err(|error| error.to_string())?;
    fs::write(file_path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        product_name: "Min Tauri",
        version: env!("CARGO_PKG_VERSION"),
        runtime: "tauri",
        migration_phase: "side-by-side scaffold",
    }
}

#[tauri::command]
fn read_setting(app: tauri::AppHandle, key: String) -> Result<SettingValue, String> {
    let values = read_settings_file(&app)?;

    Ok(SettingValue {
        key: key.clone(),
        value: values.get(&key).cloned(),
    })
}

#[tauri::command]
fn write_setting(app: tauri::AppHandle, key: String, value: String) -> Result<SettingValue, String> {
    let mut values = read_settings_file(&app)?;
    values.insert(key.clone(), value.clone());
    write_settings_file(&app, &values)?;

    Ok(SettingValue {
        key,
        value: Some(value),
    })
}

#[tauri::command]
fn create_tab(state: tauri::State<TabState>, url: String) -> Result<PrototypeTab, String> {
    let mut store = state.store.lock().map_err(|error| error.to_string())?;
    store.next_id += 1;
    let id = store.next_id;

    for tab in store.tabs.iter_mut() {
        tab.selected = false;
    }

    let tab = PrototypeTab {
        id,
        url,
        selected: true,
    };
    store.selected_id = Some(id);
    store.tabs.push(tab.clone());

    Ok(tab)
}

#[tauri::command]
fn select_tab(state: tauri::State<TabState>, id: u64) -> Result<Vec<PrototypeTab>, String> {
    let mut store = state.store.lock().map_err(|error| error.to_string())?;
    let mut found = false;

    for tab in store.tabs.iter_mut() {
        tab.selected = tab.id == id;
        found = found || tab.selected;
    }

    if !found {
        return Err(format!("unknown tab id: {id}"));
    }

    store.selected_id = Some(id);
    Ok(store.tabs.clone())
}

#[tauri::command]
fn list_tabs(state: tauri::State<TabState>) -> Result<Vec<PrototypeTab>, String> {
    let store = state.store.lock().map_err(|error| error.to_string())?;
    Ok(store.tabs.clone())
}

#[tauri::command]
fn close_tab(state: tauri::State<TabState>, id: u64) -> Result<Vec<PrototypeTab>, String> {
    let mut store = state.store.lock().map_err(|error| error.to_string())?;
    store.tabs.retain(|tab| tab.id != id);

    if store.selected_id == Some(id) {
        store.selected_id = store.tabs.first().map(|tab| tab.id);
    }

    let selected_id = store.selected_id;
    for tab in store.tabs.iter_mut() {
        tab.selected = Some(tab.id) == selected_id;
    }

    Ok(store.tabs.clone())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn migration_features() -> Vec<MigrationFeature> {
    vec![
        MigrationFeature {
            id: "settings",
            label: "Settings persistence",
            status: "foundation",
            notes: "Command-backed bridge persists JSON in the Tauri app-data directory.",
        },
        MigrationFeature {
            id: "window-controls",
            label: "Window controls",
            status: "planned",
            notes: "Maps Electron window IPC to Tauri window APIs.",
        },
        MigrationFeature {
            id: "tabs",
            label: "Tab engine",
            status: "spike",
            notes: "State model and iframe preview are present; native child webviews remain the key parity risk.",
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
            create_tab,
            select_tab,
            list_tabs,
            close_tab,
            minimize_window,
            toggle_maximize_window,
            close_window,
            migration_features
        ])
        .run(tauri::generate_context!())
        .expect("error while running Min Tauri migration app");
}
