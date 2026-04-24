import { invoke } from '@tauri-apps/api/core'

export const minRuntime = {
  host: 'tauri',
  invoke,
  appInfo () {
    return invoke('app_info')
  },
  readSetting (key) {
    return invoke('read_setting', { key })
  },
  writeSetting (key, value) {
    return invoke('write_setting', { key, value })
  },
  createTab (url) {
    return invoke('create_tab', { url })
  },
  selectTab (id) {
    return invoke('select_tab', { id })
  },
  listTabs () {
    return invoke('list_tabs')
  },
  closeTab (id) {
    return invoke('close_tab', { id })
  },
  minimizeWindow () {
    return invoke('minimize_window')
  },
  toggleMaximizeWindow () {
    return invoke('toggle_maximize_window')
  },
  closeWindow () {
    return invoke('close_window')
  },
  migrationFeatures () {
    return invoke('migration_features')
  }
}

window.minRuntime = minRuntime
