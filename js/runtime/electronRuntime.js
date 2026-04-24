var electron = require('electron')
var fs = require('fs')
var path = require('path')

/*
 * minRuntime - Electron implementation
 *
 * Exposes the canonical minRuntime API backed by existing Electron globals.
 * Legacy exports (electron, fs, ipc) are kept so that call sites that have not
 * yet been migrated continue to work unchanged.
 */

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function invoke (channel, data) {
  return electron.ipcRenderer.invoke(channel, data)
}

function send (channel, data) {
  return electron.ipcRenderer.send(channel, data)
}

function on (channel, listener) {
  electron.ipcRenderer.on(channel, listener)
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

function readTextFile (filePath) {
  return fs.readFileSync(filePath, 'utf-8')
}

function writeTextFile (filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf-8')
}

// ---------------------------------------------------------------------------
// App info
// ---------------------------------------------------------------------------

function appInfo () {
  return Promise.resolve({
    productName: 'Min',
    runtime: 'electron',
    platform: process.platform
  })
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function showItemInFolder (filePath) {
  return invoke('showItemInFolder', filePath)
}

function openPath (filePath) {
  return electron.shell.openPath(filePath)
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function showOpenDialog (options) {
  return invoke('showOpenDialog', options)
}

function showSaveDialog (options) {
  return invoke('showSaveDialog', options)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function readSetting (key) {
  return Promise.resolve().then(function () {
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
      electron.ipcRenderer.send('settingChanged', key, value)
    }
    resolve({ key: key, value: value })
  })
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------

function minimizeWindow () {
  return invoke('minimize')
}

function toggleMaximizeWindow () {
  return invoke('maximize')
}

function closeWindow () {
  return invoke('close')
}

// ---------------------------------------------------------------------------
// Downloads
//
// Electron intercepts downloads via session.will-download in the main process.
// The minRuntime surface here lets renderer code register listeners for the
// 'download-info' IPC channel that the main process emits.
// start_download / update_download / finish_download are no-ops because the
// main process owns the download lifecycle.
// ---------------------------------------------------------------------------

function startDownload (_request) {
  // Main process owns download initiation via session.will-download.
  return Promise.resolve(null)
}

function updateDownload (_id, _receivedBytes, _totalBytes) {
  return Promise.resolve(null)
}

function finishDownload (_id, _status) {
  return Promise.resolve(null)
}

function cancelDownload (savePath) {
  electron.ipcRenderer.send('cancelDownload', savePath)
  return Promise.resolve(null)
}

function listDownloads () {
  // Electron does not maintain a persistent download registry in the renderer.
  return Promise.resolve([])
}

function onDownloadInfo (handler) {
  electron.ipcRenderer.on('download-info', function (event, info) {
    handler(info)
  })
  return function () {
    electron.ipcRenderer.removeListener('download-info', handler)
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

function credentialStoreGetCredentials () {
  return invoke('credentialStoreGetCredentials')
}

function credentialStoreSetPassword (account) {
  return invoke('credentialStoreSetPassword', account)
}

function credentialStoreSetPasswordBulk (accounts) {
  return invoke('credentialStoreSetPasswordBulk', accounts)
}

function credentialStoreDeletePassword (account) {
  return invoke('credentialStoreDeletePassword', account)
}

// ---------------------------------------------------------------------------
// Internal protocol (min://)
//
// Electron resolves min://app/<path> natively via minInternalProtocol.js.
// resolveMinUrl() mirrors the same path-traversal check in JS so that renderer
// code can validate URLs before using them and the call site is symmetric with
// the Tauri implementation.
// ---------------------------------------------------------------------------

function resolveMinUrl (url) {
  return new Promise(function (resolve, reject) {
    try {
      var parsed = new URL(url)
      if (parsed.protocol !== 'min:') {
        return reject(new Error("scheme must be 'min', got '" + parsed.protocol + "'"))
      }
      if (parsed.hostname !== 'app') {
        return reject(new Error("host must be 'app', got '" + parsed.hostname + "'"))
      }
      var pathname = parsed.pathname
      if (pathname.charAt(0) === '/') {
        pathname = pathname.substring(1)
      }
      var rootDir = path.join(__dirname, '..', '..')
      var candidate = path.resolve(rootDir, pathname)
      var relative = path.relative(rootDir, candidate)
      var isSafe = relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      if (!isSafe) {
        return reject(new Error('path traversal detected'))
      }
      resolve({ original: url, localPath: candidate })
    } catch (e) {
      reject(e)
    }
  })
}

// ---------------------------------------------------------------------------
// Menus and context menus
//
// Electron context menus are opened by the main process via
// remoteMenu.js / remoteActions.js over IPC.
// openContextMenu() sends the open-context-menu IPC message; the response
// comes back as context-menu-item-selected / context-menu-will-close events.
// ---------------------------------------------------------------------------

function openContextMenu (template, x, y) {
  var id = Date.now()
  electron.ipcRenderer.send('open-context-menu', { id: id, template: template, x: x, y: y })
  return Promise.resolve({ menuId: id })
}

function contextMenuItemSelected (_menuId, _itemId) {
  // Electron emits this back to the renderer; no renderer-to-main round-trip needed.
  return Promise.resolve()
}

function contextMenuWillClose (_menuId) {
  return Promise.resolve()
}

function onContextMenuOpen (handler) {
  electron.ipcRenderer.on('context-menu-open', function (event, data) {
    handler(data)
  })
  return function () {
    electron.ipcRenderer.removeListener('context-menu-open', handler)
  }
}

// ---------------------------------------------------------------------------
// Reader / PDF paths
// ---------------------------------------------------------------------------

function openPdf (url, tabId) {
  electron.ipcRenderer.send('openPDF', { url: url, tabId: tabId || null })
  return Promise.resolve()
}

function getReaderUrl (readerPath) {
  return Promise.resolve('reader/' + (readerPath || ''))
}

function getPdfViewerUrl (pdfUrl) {
  if (pdfUrl) {
    return Promise.resolve('min://app/pages/pdfViewer/index.html?url=' + encodeURIComponent(pdfUrl))
  }
  return Promise.resolve('min://app/pages/pdfViewer/index.html')
}

function onOpenPdf (handler) {
  electron.ipcRenderer.on('openPDF', function (event, data) {
    handler(data)
  })
  return function () {
    electron.ipcRenderer.removeListener('openPDF', handler)
  }
}

// ---------------------------------------------------------------------------
// Migration features
// ---------------------------------------------------------------------------

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
      label: 'Shell integration (open/show)',
      status: 'complete',
      notes: 'openPath and showItemInFolder backed by electron.shell and IPC.'
    },
    {
      id: 'downloads',
      label: 'Downloads',
      status: 'complete',
      notes: 'session.will-download in main process; onDownloadInfo bridges events to renderer.'
    },
    {
      id: 'credentials',
      label: 'Credentials / password store',
      status: 'complete',
      notes: 'safeStorage encryption in main process via keychainService.js; IPC bridge for renderer.'
    },
    {
      id: 'internal-protocol',
      label: 'Internal protocol (min://)',
      status: 'complete',
      notes: 'min:// protocol registered in main process via minInternalProtocol.js; resolveMinUrl mirrors traversal check.'
    },
    {
      id: 'menus',
      label: 'Menus and context menus',
      status: 'complete',
      notes: 'App menu built by menu.js; context menus via remoteMenu.js + IPC.'
    },
    {
      id: 'reader-pdf',
      label: 'Reader / PDF paths',
      status: 'complete',
      notes: 'Content-Type interception in download.js; openPDF IPC; reader pages via min:// protocol.'
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
  migrationFeatures,

  // legacy exports kept for unmigrated call sites
  electron,
  fs,
  ipc: electron.ipcRenderer
}
