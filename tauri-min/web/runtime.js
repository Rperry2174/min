import { invoke } from '@tauri-apps/api/core'

/*
 * minRuntime - Tauri implementation
 *
 * Exposes the canonical minRuntime API backed by @tauri-apps/api and Rust
 * commands registered in src-tauri/src/lib.rs.
 *
 * The surface intentionally mirrors js/runtime/electronRuntime.js so that
 * renderer code can call window.minRuntime without knowing the host runtime.
 */

// IPC shim
// Tauri does not have a generic IPC channel like Electron's ipcRenderer.
// send() and on() are no-ops stubs provided so that code that feature-detects
// their presence does not throw.  Callers that need bidirectional messaging
// should migrate to the command-based methods below.

function send (_channel, _data) {
  // no-op: Tauri uses invoke() for renderer-to-backend communication
}

function on (_channel, _listener) {
  // no-op: Tauri event subscriptions are handled per-command via Tauri's event
  // system.  Migrate callers to window.__TAURI__.event.listen() if needed.
}

// App info

function appInfo () {
  return invoke('app_info')
}

// Settings

function readSetting (key) {
  return invoke('read_setting', { key })
}

function writeSetting (key, value) {
  return invoke('write_setting', { key, value })
}

// Filesystem

function readTextFile (filePath) {
  return invoke('read_text_file', { path: filePath })
}

function writeTextFile (filePath, contents) {
  return invoke('write_text_file', { path: filePath, contents })
}

// Dialogs

function showOpenDialog (options) {
  return invoke('show_open_dialog', { options: options || {} })
}

function showSaveDialog (options) {
  return invoke('show_save_dialog', { options: options || {} })
}

// Shell integration

function showItemInFolder (filePath) {
  return invoke('show_item_in_folder', { path: filePath })
}

function openPath (filePath) {
  return invoke('open_path', { path: filePath })
}

// Window controls

function minimizeWindow () {
  return invoke('minimize_window')
}

function toggleMaximizeWindow () {
  return invoke('toggle_maximize_window')
}

function closeWindow () {
  return invoke('close_window')
}

// Tab management (spike)
//
// These thin wrappers expose all tab commands to callers that use
// window.minRuntime directly rather than going through TabEngine.

function createTab (url, bounds) {
  return invoke('create_tab', { url, bounds: bounds || null })
}

function selectTab (id) {
  return invoke('select_tab', { id })
}

function loadUrlInTab (id, url) {
  return invoke('load_url_in_tab', { id, url })
}

function tabDidFinishLoad (id, finalUrl, title) {
  return invoke('tab_did_finish_load', { id, finalUrl: finalUrl || null, title: title || null })
}

function setTabBounds (id, bounds) {
  return invoke('set_tab_bounds', { id, bounds })
}

function getTabBounds (id) {
  return invoke('get_tab_bounds', { id })
}

function listTabs () {
  return invoke('list_tabs')
}

function closeTab (id) {
  return invoke('close_tab', { id })
}

// Migration features

function migrationFeatures () {
  return invoke('migration_features')
}

export const minRuntime = {
  host: 'tauri',

  // IPC shims
  invoke,
  send,
  on,

  // app
  appInfo,

  // settings
  readSetting,
  writeSetting,

  // filesystem
  readTextFile,
  writeTextFile,

  // dialogs
  showOpenDialog,
  showSaveDialog,

  // shell
  showItemInFolder,
  openPath,

  // window controls
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,

  // tab management (spike)
  createTab,
  selectTab,
  loadUrlInTab,
  tabDidFinishLoad,
  setTabBounds,
  getTabBounds,
  listTabs,
  closeTab,

  // migration introspection
  migrationFeatures
}

window.minRuntime = minRuntime
