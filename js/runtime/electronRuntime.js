var electron = require('electron')
var fs = require('fs')

function invoke (channel, data) {
  return electron.ipcRenderer.invoke(channel, data)
}

function send (channel, data) {
  return electron.ipcRenderer.send(channel, data)
}

function on (channel, listener) {
  electron.ipcRenderer.on(channel, listener)
}

function readTextFile (filePath) {
  return fs.readFileSync(filePath, 'utf-8')
}

function writeTextFile (filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf-8')
}

function appInfo () {
  return Promise.resolve({
    productName: 'Min',
    runtime: 'electron',
    platform: process.platform
  })
}

function showItemInFolder (filePath) {
  return invoke('showItemInFolder', filePath)
}

function openPath (filePath) {
  return electron.shell.openPath(filePath)
}

module.exports = {
  host: 'electron',
  electron,
  fs,
  ipc: electron.ipcRenderer,
  invoke,
  send,
  on,
  readTextFile,
  writeTextFile,
  appInfo,
  showItemInFolder,
  openPath
}
