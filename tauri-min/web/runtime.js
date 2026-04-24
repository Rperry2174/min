import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/*
 * minRuntime - Tauri implementation
 *
 * Exposes the canonical minRuntime API backed by @tauri-apps/api and Rust
 * commands registered in src-tauri/src/lib.rs.
 *
 * The surface intentionally mirrors js/runtime/electronRuntime.js so that
 * renderer code can call window.minRuntime without knowing the host runtime.
 */

// ---------------------------------------------------------------------------
// IPC shim
// Tauri does not have a generic IPC channel like Electron's ipcRenderer.
// send() and on() are no-ops stubs so that code that feature-detects
// their presence does not throw.  Callers that need bidirectional messaging
// should migrate to the command-based methods below.
// ---------------------------------------------------------------------------

function send (_channel, _data) {
  // no-op: Tauri uses invoke() for renderer-to-backend communication
}

function on (_channel, _listener) {
  // no-op: Tauri event subscriptions are handled per-command via Tauri's event
  // system.  Migrate callers to window.__TAURI__.event.listen() if needed.
}

// ---------------------------------------------------------------------------
// App info
// ---------------------------------------------------------------------------

function appInfo () {
  return invoke('app_info')
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function readSetting (key) {
  return invoke('read_setting', { key })
}

function writeSetting (key, value) {
  return invoke('write_setting', { key, value })
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

function readTextFile (filePath) {
  return invoke('read_text_file', { path: filePath })
}

function writeTextFile (filePath, contents) {
  return invoke('write_text_file', { path: filePath, contents })
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function showOpenDialog (options) {
  return invoke('show_open_dialog', { options: options || {} })
}

function showSaveDialog (options) {
  return invoke('show_save_dialog', { options: options || {} })
}

// ---------------------------------------------------------------------------
// Shell integration
// ---------------------------------------------------------------------------

function showItemInFolder (filePath) {
  return invoke('show_item_in_folder', { path: filePath })
}

function openPath (filePath) {
  return invoke('open_path', { path: filePath })
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------

function minimizeWindow () {
  return invoke('minimize_window')
}

function toggleMaximizeWindow () {
  return invoke('toggle_maximize_window')
}

function closeWindow () {
  return invoke('close_window')
}

// ---------------------------------------------------------------------------
// Tab management (spike)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Downloads
//
// GAP: session.will-download interception for navigation-triggered downloads
// is not available without native child-webview support.  These commands track
// renderer-initiated downloads explicitly.
// ---------------------------------------------------------------------------

function startDownload (request) {
  return invoke('start_download', { request })
}

function updateDownload (id, receivedBytes, totalBytes) {
  return invoke('update_download', { id, receivedBytes, totalBytes })
}

function finishDownload (id, status) {
  return invoke('finish_download', { id, status })
}

function cancelDownload (id) {
  return invoke('cancel_download', { id })
}

function listDownloads () {
  return invoke('list_downloads')
}

/**
 * Subscribe to download-info events.
 * Returns an unlisten function (call it to unsubscribe).
 * Mirrors: ipcRenderer.on('download-info', handler) in Electron.
 */
function onDownloadInfo (handler) {
  return listen('download-info', (event) => handler(event.payload))
}

// ---------------------------------------------------------------------------
// Credentials
//
// GAP: Electron safeStorage encrypts with an OS keychain key.
// This implementation persists plain JSON.  Replace with tauri-plugin-stronghold
// or the keyring crate before shipping.
// ---------------------------------------------------------------------------

function credentialStoreGetCredentials () {
  return invoke('credential_store_get_credentials')
}

function credentialStoreSetPassword (account) {
  return invoke('credential_store_set_password', { account })
}

function credentialStoreSetPasswordBulk (accounts) {
  return invoke('credential_store_set_password_bulk', { accounts })
}

function credentialStoreDeletePassword (account) {
  return invoke('credential_store_delete_password', { account })
}

// ---------------------------------------------------------------------------
// Internal protocol (min://)
//
// GAP: Full URI-scheme registration requires tauri::Builder::register_uri_scheme_protocol
// and a CSP update.  resolveMinUrl() provides the path mapping so renderer
// code can be migrated incrementally.
// ---------------------------------------------------------------------------

function resolveMinUrl (url) {
  return invoke('resolve_min_url', { url })
}

// ---------------------------------------------------------------------------
// Menus and context menus
//
// GAP: Native popup rendering requires the community tauri-plugin-context-menu
// crate.  Current implementation falls back to a frontend JS menu via events.
// ---------------------------------------------------------------------------

function openContextMenu (template, x, y) {
  return invoke('open_context_menu', { request: { template, x, y } })
}

function contextMenuItemSelected (menuId, itemId) {
  return invoke('context_menu_item_selected', { menuId, itemId })
}

function contextMenuWillClose (menuId) {
  return invoke('context_menu_will_close', { menuId })
}

/**
 * Subscribe to context-menu-open events emitted by the Rust side.
 * Returns an unlisten function.
 */
function onContextMenuOpen (handler) {
  return listen('context-menu-open', (event) => handler(event.payload))
}

// ---------------------------------------------------------------------------
// Reader / PDF paths
//
// GAP: Content-Type interception (Electron webRequest.onHeadersReceived)
// requires native child-webview support.
// ---------------------------------------------------------------------------

function openPdf (url, tabId) {
  return invoke('open_pdf', { request: { url, tabId: tabId || null } })
}

function getReaderUrl (path) {
  return invoke('get_reader_url', { path: path || null })
}

function getPdfViewerUrl (pdfUrl) {
  return invoke('get_pdf_viewer_url', { pdfUrl: pdfUrl || null })
}

/**
 * Subscribe to open-pdf events emitted when a PDF URL should be opened.
 * Returns an unlisten function.
 * Mirrors: ipcRenderer.on('openPDF', handler) in Electron.
 */
function onOpenPdf (handler) {
  return listen('open-pdf', (event) => handler(event.payload))
}

// ---------------------------------------------------------------------------
// Migration features
// ---------------------------------------------------------------------------

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

  // downloads
  startDownload,
  updateDownload,
  finishDownload,
  cancelDownload,
  listDownloads,
  onDownloadInfo,

  // credentials
  credentialStoreGetCredentials,
  credentialStoreSetPassword,
  credentialStoreSetPasswordBulk,
  credentialStoreDeletePassword,

  // internal protocol
  resolveMinUrl,

  // menus / context menus
  openContextMenu,
  contextMenuItemSelected,
  contextMenuWillClose,
  onContextMenuOpen,

  // reader / PDF
  openPdf,
  getReaderUrl,
  getPdfViewerUrl,
  onOpenPdf,

  // migration introspection
  migrationFeatures
}

window.minRuntime = minRuntime
