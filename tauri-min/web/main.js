import './runtime.js'
import { TabEngine } from './tabEngine.js'

// ─── Element references ────────────────────────────────────────────────────

const tabStrip = document.getElementById('tab-strip')
const newTabForm = document.getElementById('new-tab-form')
const newTabUrl = document.getElementById('new-tab-url')
const navigateForm = document.getElementById('navigate-form')
const addressInput = document.getElementById('address-input')
const goBtn = document.getElementById('go-btn')
const closeTabBtn = document.getElementById('close-tab-btn')
const loadingIndicator = document.getElementById('loading-indicator')
const noTabPlaceholder = document.getElementById('no-tab-placeholder')
const tabIframe = document.getElementById('tab-iframe')
const tabStateOutput = document.getElementById('tab-state-output')
const runtimeInfo = document.getElementById('runtime-info')
const appInfoOutput = document.getElementById('app-info-output')
const refreshAppInfo = document.getElementById('refresh-app-info')
const minimizeWindow = document.getElementById('minimize-window')
const toggleMaximizeWindow = document.getElementById('toggle-maximize-window')
const demoSetting = document.getElementById('demo-setting')
const saveSetting = document.getElementById('save-setting')
const settingsOutput = document.getElementById('settings-output')
const featuresOutput = document.getElementById('features-output')

// ─── TabEngine instance ────────────────────────────────────────────────────

const engine = new TabEngine(tabIframe)

// ─── UI rendering ──────────────────────────────────────────────────────────

function renderTabStrip () {
  const tabs = engine.getTabs()
  const selectedId = engine.getSelectedId()

  tabStrip.replaceChildren()

  tabs.forEach(function (tab) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.role = 'tab'
    btn.className = 'tab-button'
    btn.setAttribute('aria-selected', tab.selected ? 'true' : 'false')

    const label = document.createElement('span')
    label.className = 'tab-label'
    label.textContent = tab.title || tab.url

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'tab-close'
    closeBtn.title = 'Close tab'
    closeBtn.textContent = '×'
    closeBtn.setAttribute('aria-label', 'Close ' + (tab.title || tab.url))
    closeBtn.addEventListener('click', async function (e) {
      e.stopPropagation()
      await engine.closeTab(tab.id)
      renderTabStrip()
      updateAddressBar()
    })

    btn.append(label, closeBtn)
    btn.addEventListener('click', async function () {
      await engine.selectTab(tab.id)
      renderTabStrip()
      updateAddressBar()
    })

    tabStrip.append(btn)
  })

  updateTabState()
}

function updateAddressBar () {
  const id = engine.getSelectedId()
  if (id === null) {
    addressInput.value = ''
    addressInput.placeholder = 'No tab selected'
    addressInput.disabled = true
    goBtn.disabled = true
    closeTabBtn.disabled = true
    noTabPlaceholder.hidden = false
    tabIframe.hidden = true
    return
  }

  const tab = engine.getTabs().find(function (t) { return t.id === id })
  if (tab) {
    addressInput.value = tab.url
    addressInput.disabled = false
    goBtn.disabled = false
    closeTabBtn.disabled = false
  }

  noTabPlaceholder.hidden = true
  tabIframe.hidden = false
}

function setLoading (loading) {
  loadingIndicator.classList.toggle('loading', loading)
  loadingIndicator.setAttribute('aria-hidden', String(!loading))
}

function updateTabState () {
  const tabs = engine.getTabs()
  tabStateOutput.textContent = JSON.stringify(tabs, null, 2)
}

// ─── Engine event wiring ───────────────────────────────────────────────────

engine.on('tab-created', function () {
  renderTabStrip()
  updateAddressBar()
  setLoading(true)
})

engine.on('tab-selected', function () {
  renderTabStrip()
  updateAddressBar()
})

engine.on('tab-closed', function () {
  renderTabStrip()
  updateAddressBar()
})

engine.on('did-start-loading', function () {
  setLoading(true)
})

engine.on('did-finish-load', function () {
  setLoading(false)
  renderTabStrip() // title may have changed
})

engine.on('did-fail-load', function () {
  setLoading(false)
})

// ─── New-tab form ──────────────────────────────────────────────────────────

newTabForm.addEventListener('submit', async function (e) {
  e.preventDefault()
  const url = newTabUrl.value.trim()
  if (!url) return
  await engine.createTab(url)
})

// ─── Navigate form (address bar) ──────────────────────────────────────────

navigateForm.addEventListener('submit', async function (e) {
  e.preventDefault()
  const id = engine.getSelectedId()
  if (id === null) return
  const url = addressInput.value.trim()
  if (!url) return
  setLoading(true)
  await engine.loadUrl(id, url)
  renderTabStrip()
})

// ─── Close-tab button ─────────────────────────────────────────────────────

closeTabBtn.addEventListener('click', async function () {
  const id = engine.getSelectedId()
  if (id === null) return
  await engine.closeTab(id)
  renderTabStrip()
  updateAddressBar()
})

// ─── Migration info panel ─────────────────────────────────────────────────

function writeJson (el, value) {
  el.textContent = JSON.stringify(value, null, 2)
}

async function renderAppInfo () {
  try {
    writeJson(appInfoOutput, await window.minRuntime.appInfo())
  } catch (err) {
    appInfoOutput.textContent = err.message
  }
}

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

refreshAppInfo.addEventListener('click', renderAppInfo)

minimizeWindow.addEventListener('click', function () {
  window.minRuntime.minimizeWindow().catch(function (err) {
    appInfoOutput.textContent = err.message
  })
})

toggleMaximizeWindow.addEventListener('click', function () {
  window.minRuntime.toggleMaximizeWindow().catch(function (err) {
    appInfoOutput.textContent = err.message
  })
})

saveSetting.addEventListener('click', async function () {
  const result = await window.minRuntime.writeSetting('demoSetting', demoSetting.value)
  writeJson(settingsOutput, result)
})

// ─── Boot ──────────────────────────────────────────────────────────────────

async function boot () {
  await engine.init()

  const features = await window.minRuntime.migrationFeatures()
  renderRuntimeInfo(features)
  writeJson(featuresOutput, features)

  await renderAppInfo()

  const saved = await window.minRuntime.readSetting('demoSetting')
  if (saved.value) {
    demoSetting.value = saved.value
  }

  renderTabStrip()
  updateAddressBar()
}

boot().catch(function (err) {
  appInfoOutput.textContent = err.message
  console.error('boot error:', err)
})
