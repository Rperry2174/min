var electron = require('electron')
var fs = require('fs')

/*
 * minRuntime – Electron implementation
 *
 * Exposes the canonical minRuntime API backed by existing Electron globals.
 * Legacy exports (electron, fs, ipc) are kept so that call sites that have not
 * yet been migrated continue to work unchanged.
 */

// ── IPC ──────────────────────────────────────────────────────────────────────

function invoke (channel, data) {
  return electron.ipcRenderer.invoke(channel, data)
}

function send (channel, data) {
  return electron.ipcRenderer.send(channel, data)
}

function on (channel, listener) {
  electron.ipcRenderer.on(channel, listener)
}

// ── Filesystem ───────────────────────────────────────────────────────────────

function readTextFile (filePath) {
  return fs.readFileSync(filePath, 'utf-8')
}

function writeTextFile (filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf-8')
}

// ── App info ─────────────────────────────────────────────────────────────────

function appInfo () {
  return Promise.resolve({
    productName: 'Min',
    runtime: 'electron',
    platform: process.platform
  })
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function showItemInFolder (filePath) {
  return invoke('showItemInFolder', filePath)
}

function openPath (filePath) {
  return electron.shell.openPath(filePath)
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

function showOpenDialog (options) {
  return invoke('showOpenDialog', options)
}

function showSaveDialog (options) {
  return invoke('showSaveDialog', options)
}

// ── Settings ──────────────────────────────────────────────────────────────────

function readSetting (key) {
  return Promise.resolve({ key: key, value: electron.ipcRenderer.sendSync ? undefined : undefined })
    .then(function () {
      // Settings are initialised synchronously in the renderer via the settings
      // module (js/util/settings/settings.js) which reads the file directly.
      // This method provides the same key through the minRuntime surface so that
      // Tauri-ported code can call it uniformly.  The renderer settings module is
      // the authoritative source; we delegate to it when available.
      var settingsModule
      try { settingsModule = require('util/settings/settings.js') } catch (e) {}
      return { key: key, value: settingsModule ? settingsModule.get(key) : undefined }
    })
}

function writeSetting (key, value) {
  return new Promise(function (resolve) {
    var settingsModule
    try { settingsModule = require('util/settings/settings.js') } catch (e) {}
    if (settingsModule) {
      settingsModule.set(key, value)
    } else {
      // Fallback: send directly over IPC (main process will persist).
      electron.ipcRenderer.send('settingChanged', key, value)
    }
    resolve({ key: key, value: value })
  })
}

// ── Window controls ───────────────────────────────────────────────────────────

function minimizeWindow () {
  return invoke('minimize')
}

function toggleMaximizeWindow () {
  return invoke('maximize')
}

function closeWindow () {
  return invoke('close')
}

// ── Migration features ────────────────────────────────────────────────────────

function migrationFeatures () {
  return Promise.resolve([
    {
      id: 'settings',
      label: 'Settings persistence',
      status: 'complete',
      notes: 'Renderer reads/writes via the settings module; main process persists atomically.'
    },
    {
      id: 'window-controls',
      label: 'Window controls',
      status: 'complete',
      notes: 'minimize / toggleMaximize / close routed through IPC to main process.'
    },
    {
      id: 'dialogs',
      label: 'Native dialogs',
      status: 'complete',
      notes: 'showOpenDialog and showSaveDialog proxied to main via IPC.'
    },
    {
      id: 'shell',
      label: 'Shell integration',
      status: 'complete',
      notes: 'openPath and showItemInFolder backed by electron.shell and IPC.'
    }
  ])
}

module.exports = {
  host: 'electron',

  // canonical minRuntime surface
  invoke,
  send,
  on,
  readTextFile,
  writeTextFile,
  appInfo,
  showItemInFolder,
  openPath,
  showOpenDialog,
  showSaveDialog,
  readSetting,
  writeSetting,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  migrationFeatures,

  // legacy exports kept for unmigrated call sites
  electron,
  fs,
  ipc: electron.ipcRenderer
}
