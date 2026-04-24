/**
 * tabEngine.js — Tauri tab engine prototype
 *
 * Implements the narrow proof surface:
 *   create tab · select tab · load URL · close tab · resize awareness
 *
 * PROTOTYPE MODEL
 * ---------------
 * Electron uses WebContentsView: a native OS-level process attached to a
 * BrowserWindow at pixel-precise bounds.  Tauri v2 (stable) does not expose an
 * equivalent "child webview" API from the frontend JS layer.  This prototype
 * instead renders tab content in a single <iframe> element whose src is swapped
 * on tab selection.  The state (id, url, title, loading, bounds) is authoritative
 * in Rust (lib.rs TabStore); the iframe is a best-effort content display fallback.
 *
 * See migration/docs/webview-spike-gaps.md for the full gap list.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// ─── Event bus ────────────────────────────────────────────────────────────────

const listeners = {}

function emit (eventName, detail) {
  const fns = listeners[eventName]
  if (!fns) return
  fns.forEach(function (fn) { fn(detail) })
}

// ─── Resize observer ──────────────────────────────────────────────────────────

/**
 * Compute the view bounds the way js/webviews.js::getViewBounds() does.
 * We use a fixed navbar height matching Electron's default (36 px) and honour
 * the same margin accumulator pattern so the gap doc comparison is accurate.
 */
function computeViewBounds (margins) {
  const m = margins || [0, 0, 0, 0] // top, right, bottom, left
  const navbarHeight = 36
  return {
    x: Math.round(m[3]),
    y: Math.round(m[0]) + navbarHeight,
    width: window.innerWidth - Math.round(m[1] + m[3]),
    height: window.innerHeight - Math.round(m[0] + m[2]) - navbarHeight
  }
}

// ─── TabEngine ────────────────────────────────────────────────────────────────

export class TabEngine {
  constructor (iframeEl) {
    /** @type {HTMLIFrameElement} */
    this._iframe = iframeEl

    /** @type {Map<number, object>} local shadow of Rust TabStore */
    this._tabs = new Map()

    /** @type {number|null} */
    this._selectedId = null

    /** @type {number[]} top/right/bottom/left margin accumulators */
    this._margins = [0, 0, 0, 0]

    this._resizeScheduled = false
    this._unlisten = null

    this._bindResize()
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /** Subscribe to Tauri tab-event payloads and start listening for resize. */
  async init () {
    this._unlisten = await listen('tab-event', (event) => {
      const { tab_id: tabId, event: name, data } = event.payload
      emit(name, { tabId, data })
      emit('tab-event', { tabId, event: name, data })
    })
    // Sync initial tab list in case tabs survived from a previous session.
    const tabs = await invoke('list_tabs')
    this._syncFromList(tabs)
  }

  /** Remove the resize listener and Tauri event subscription. */
  destroy () {
    window.removeEventListener('resize', this._onResize)
    if (this._unlisten) {
      this._unlisten()
      this._unlisten = null
    }
  }

  // ── Public API (mirrors Electron webviews surface) ──────────────────────────

  /**
   * Create a new tab and load a URL in it.
   * Electron equivalent: webviews.add() → ipc createView + loadURLInView
   */
  async createTab (url) {
    const bounds = computeViewBounds(this._margins)
    const tab = await invoke('create_tab', { url, bounds })
    this._syncTab(tab)
    this._showTab(tab.id)
    return tab
  }

  /**
   * Select an existing tab by id (switch visible content).
   * Electron equivalent: webviews.setSelected(id)
   */
  async selectTab (id) {
    const tabs = await invoke('select_tab', { id })
    this._syncFromList(tabs)
    this._showTab(id)
    return tabs
  }

  /**
   * Navigate the active tab (or a specific tab) to a new URL.
   * Electron equivalent: webviews.update(id, url) → ipc loadURLInView
   */
  async loadUrl (id, url) {
    const tab = await invoke('load_url_in_tab', { id, url })
    this._syncTab(tab)
    if (id === this._selectedId) {
      this._iframe.src = url
    }
    return tab
  }

  /**
   * Close a tab and auto-select the most recent remaining one.
   * Electron equivalent: webviews.destroy(id) → ipc destroyView
   */
  async closeTab (id) {
    const tabs = await invoke('close_tab', { id })
    this._tabs.delete(id)
    this._syncFromList(tabs)

    if (this._selectedId !== null && this._tabs.has(this._selectedId)) {
      this._showTab(this._selectedId)
    } else {
      this._clearPreview()
    }
    return tabs
  }

  /**
   * Push updated viewport bounds to Rust (after window resize or margin change).
   * Electron equivalent: webviews.resize() → ipc setBounds
   */
  async pushBounds (id, bounds) {
    id = id !== undefined ? id : this._selectedId
    if (id === null) return null
    const tab = await invoke('set_tab_bounds', { id, bounds })
    this._syncTab(tab)
    return tab
  }

  /**
   * Adjust view margins (e.g. sidebar open/close) and immediately resize.
   * Electron equivalent: webviews.adjustMargin(margins)
   */
  adjustMargin (margins) {
    for (let i = 0; i < margins.length; i++) {
      this._margins[i] += margins[i]
    }
    this._scheduleResize()
  }

  /** Return a snapshot of all tabs. */
  getTabs () {
    return Array.from(this._tabs.values())
  }

  /** Return the selected tab id. */
  getSelectedId () {
    return this._selectedId
  }

  // ── Event subscription ──────────────────────────────────────────────────────

  /**
   * Subscribe to a named tab event.
   * Event names mirror Electron view-event names where possible:
   *   tab-created, tab-selected, tab-closed,
   *   did-start-loading, did-finish-load,
   *   tab-event (catch-all)
   */
  on (eventName, fn) {
    if (!listeners[eventName]) listeners[eventName] = []
    listeners[eventName].push(fn)
  }

  off (eventName, fn) {
    if (!listeners[eventName]) return
    listeners[eventName] = listeners[eventName].filter(function (f) { return f !== fn })
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  _syncTab (tab) {
    this._tabs.set(tab.id, tab)
    if (tab.selected) this._selectedId = tab.id
  }

  _syncFromList (tabs) {
    const incoming = new Map(tabs.map(function (t) { return [t.id, t] }))
    this._tabs = incoming
    const selected = tabs.find(function (t) { return t.selected })
    this._selectedId = selected ? selected.id : null
  }

  _showTab (id) {
    const tab = this._tabs.get(id)
    if (!tab) return

    this._iframe.src = tab.url
    this._iframe.setAttribute('data-tab-id', String(id))

    // Wire up load callback to report did-finish-load back to Rust.
    this._iframe.onload = () => {
      let finalUrl = tab.url
      let title = tab.title
      try {
        finalUrl = this._iframe.contentWindow?.location?.href || finalUrl
        title = this._iframe.contentDocument?.title || title
      } catch (_) {
        // cross-origin frames block location/title access
      }
      invoke('tab_did_finish_load', { id, finalUrl, title }).then((updated) => {
        this._syncTab(updated)
        emit('did-finish-load', { tabId: id })
        emit('tab-event', { tabId: id, event: 'did-finish-load' })
      })
    }

    this._iframe.onerror = () => {
      emit('did-fail-load', { tabId: id })
      emit('tab-event', { tabId: id, event: 'did-fail-load' })
    }

    this._selectedId = id
    emit('view-shown', { tabId: id })
  }

  _clearPreview () {
    this._iframe.removeAttribute('src')
    this._iframe.removeAttribute('data-tab-id')
    this._iframe.onload = null
    this._selectedId = null
  }

  _scheduleResize () {
    if (this._resizeScheduled) return
    this._resizeScheduled = true
    requestAnimationFrame(() => {
      this._resizeScheduled = false
      const id = this._selectedId
      if (id !== null) {
        const bounds = computeViewBounds(this._margins)
        invoke('set_tab_bounds', { id, bounds }).catch(function () {})
      }
    })
  }

  _bindResize () {
    this._onResize = () => { this._scheduleResize() }
    window.addEventListener('resize', this._onResize)
  }
}
