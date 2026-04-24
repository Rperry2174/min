import './runtime.js'

const runtimeInfo = document.getElementById('runtime-info')
const appInfoOutput = document.getElementById('app-info-output')
const refreshAppInfo = document.getElementById('refresh-app-info')
const minimizeWindow = document.getElementById('minimize-window')
const toggleMaximizeWindow = document.getElementById('toggle-maximize-window')
const demoSetting = document.getElementById('demo-setting')
const saveSetting = document.getElementById('save-setting')
const settingsOutput = document.getElementById('settings-output')
const tabForm = document.getElementById('tab-form')
const tabUrl = document.getElementById('tab-url')
const tabList = document.getElementById('tab-list')
const tabPreview = document.getElementById('tab-preview')

function renderRuntimeInfo (features) {
  runtimeInfo.replaceChildren()
  const rows = [
    ['Host', window.minRuntime.host],
    ['Tauri bridge', 'ready'],
    ['Feature clusters', features.length.toString()]
  ]

  rows.forEach(function ([label, value]) {
    const row = document.createElement('div')
    const dt = document.createElement('dt')
    const dd = document.createElement('dd')
    dt.textContent = label
    dd.textContent = value
    row.append(dt, dd)
    runtimeInfo.append(row)
  })
}

function writeJson (element, value) {
  element.textContent = JSON.stringify(value, null, 2)
}

async function renderAppInfo () {
  try {
    writeJson(appInfoOutput, await window.minRuntime.appInfo())
  } catch (error) {
    appInfoOutput.textContent = error.message
  }
}

async function renderTabs () {
  const tabs = await window.minRuntime.listTabs()
  tabList.textContent = ''

  tabs.forEach(function (tab) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = tab.url
    button.setAttribute('aria-pressed', tab.selected ? 'true' : 'false')
    button.addEventListener('click', async function () {
      await window.minRuntime.selectTab(tab.id)
      tabPreview.src = tab.url
      await renderTabs()
    })
    tabList.append(button)

    if (tab.selected) {
      tabPreview.src = tab.url
    }
  })
}

refreshAppInfo.addEventListener('click', renderAppInfo)
minimizeWindow.addEventListener('click', function () {
  window.minRuntime.minimizeWindow().catch(function (error) {
    appInfoOutput.textContent = error.message
  })
})
toggleMaximizeWindow.addEventListener('click', function () {
  window.minRuntime.toggleMaximizeWindow().catch(function (error) {
    appInfoOutput.textContent = error.message
  })
})

saveSetting.addEventListener('click', async function () {
  const result = await window.minRuntime.writeSetting('demoSetting', demoSetting.value)
  writeJson(settingsOutput, result)
})

tabForm.addEventListener('submit', async function (event) {
  event.preventDefault()
  await window.minRuntime.createTab(tabUrl.value)
  await renderTabs()
})

async function boot () {
  const features = await window.minRuntime.migrationFeatures()
  renderRuntimeInfo(features)
  await renderAppInfo()
  const saved = await window.minRuntime.readSetting('demoSetting')
  if (saved.value) {
    demoSetting.value = saved.value
  }
  await renderTabs()
}

boot().catch(function (error) {
  appInfoOutput.textContent = error.message
})
