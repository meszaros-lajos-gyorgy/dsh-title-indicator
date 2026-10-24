/**
 * Browser half of dsh-title-indicator.
 *
 * The Web GUI fetches this file through /plugins and executes it as a
 * closure-factory module; React comes from the shell's frozen module table, so
 * the bundle stays dependency-free.
 *
 * Two seats, one projection:
 *
 * - `shell.overlay` holds an invisible component that keeps the tab title one
 *   marker ahead of the workspace:
 *
 *     "🟠 | "  a Thread waits for one click from you (approval, plan, answer)
 *     "🕐 | "  some Thread is working
 *     "⚠️ | "  everything stopped, and a Thread stopped because it failed
 *     "✅ | "  everything settled, and at least one Thread finished unread
 *
 *   Precedence is exactly that order: a pending interaction outranks everything,
 *   because answering it usually takes one click and the work stays blocked
 *   until you do. The marker is a prefix on whatever title the layout owns
 *   ("Session — Product"), never a replacement.
 *
 * - `settings.section` holds the Sounds card: one sound per state, picked from
 *   the user's own files, plus a mute switch. Choices live in this browser
 *   (IndexedDB); the server only serves the package's built-in sounds.
 *
 * "Stopped while I was away" is what makes ⚠️ and ✅ honest. A Thread that
 * finishes while the page is focused was watched happen, so it leaves the title
 * alone; the moment the page regains attention, both markers clear. 🟠 does not
 * wait for attention — a pending answer is useful to see from anywhere.
 */

window.__ModuleLoader__.load({
  id: 'dsh-title-indicator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement

    /** Host route carrying the last `turn/end` outcome per Session. */
    const STATUS_URL = '/plugins/dsh-title-indicator/status'

    /**
     * Built-in sound for the done state, embedded as a data URL.
     *
     * It ships inside the client bundle rather than behind a host route: this
     * profile's HMR watches configuration only, so a new host route would stay
     * dormant until the next restart, while a bundle update lands on the next
     * page load. The source file lives beside this module as `sounds/done.mp3`.
     *
     * The other three states stay silent until the user picks a file, so the
     * package ships exactly one, deliberately chosen sound.
     */
    const DEFAULT_SOUNDS = {
      done: 'data:audio/mpeg;base64,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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LE6YMLaZz0oIh0iQgyGYgAibhVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=',
    }

    /** Title refresh cadence, and the poll for fresh turn outcomes. */
    const REFRESH_MS = 2000

    /** How far after a stop a failed turn may sit and still explain it. */
    const ERROR_WINDOW_MS = 60_000

    /** How far before a stop a failed turn may sit (clock and observation skew). */
    const ERROR_LEAD_MS = 5_000

    /**
     * Markers pushed in front of the layout-owned title.
     *
     * Restrained emoji, one per shape, because a tab title is rendered in the
     * browser's own color: a plain glyph cannot carry a tone, and a leading
     * "…" reads like the tab's own truncation. The earlier ❗/❓ pair failed
     * that test — both are red, so at tab size they looked identical. These
     * four are distinguishable by shape alone:
     *
     *   🟠  the orange dot of the sidebar: something asks for you, and it has
     *       to catch the eye from a background tab
     *   🕐  a clock: work in progress
     *   ⚠️  a warning triangle: a stop was a failure
     *   ✅  the green check: finished unread
     */
    const PENDING_PREFIX = '🟠 '
    const RUNNING_PREFIX = '🕐 '
    const ERROR_PREFIX = '⚠️ '
    const DONE_PREFIX = '✅ '

    const PREFIXES = [RUNNING_PREFIX, ERROR_PREFIX, PENDING_PREFIX, DONE_PREFIX]

    /** One sound slot per title state, in title-priority order for the UI. */
    const SOUND_STATES = ['pending', 'running', 'error', 'done']

    /** Rows of the Sounds settings card. */
    const SOUND_ROWS = [
      { state: 'pending', emoji: '🟠', label: 'Waiting for you' },
      { state: 'running', emoji: '🕐', label: 'Working' },
      { state: 'error', emoji: '⚠️', label: 'Failed' },
      { state: 'done', emoji: '✅', label: 'Done, unread' },
    ]

    const STYLE_ID = 'dsh-title-indicator/client.css'
    const CSS = `
.dsh-sounds {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dsh-sounds-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.dsh-sounds-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.dsh-sounds-description {
  margin: 4px 0 0;
  max-width: 56ch;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sounds-mute {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.dsh-sounds-mute input {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
}

.dsh-sounds-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: -4px;
}

.dsh-sounds-volume {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.dsh-sounds-volume input[type='range'] {
  width: 96px;
  margin: 0;
  accent-color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.dsh-sounds-volume-value {
  min-width: 32px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--dsw-alias-label-primary);
}

.dsh-sounds-error {
  margin-top: 2px;
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-state-error-primary);
}

.dsh-sounds-rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-md, 10px);
  overflow: hidden;
}

.dsh-sounds-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.dsh-sounds-row + .dsh-sounds-row {
  border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-sounds-emoji {
  flex: none;
  width: 20px;
  font-size: 15px;
  text-align: center;
}

.dsh-sounds-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.dsh-sounds-label {
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
}

.dsh-sounds-source {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-sounds-actions {
  display: flex;
  flex: none;
  gap: 6px;
}

.dsh-sounds-button {
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.dsh-sounds-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-sounds-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.dsh-sounds-footnote {
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
`

    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-title-indicator'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /**
     * Remove one of our own markers from a title someone else owned.
     * @param {string} raw - current document title.
     * @returns {string} the title without a leading marker.
     */
    function stripOwnPrefix(raw) {
      if (typeof raw !== 'string') return ''
      for (const prefix of PREFIXES) {
        if (raw.startsWith(prefix)) return raw.slice(prefix.length)
      }
      return raw
    }

    /**
     * Compose a marked title; an empty marker yields the bare title.
     * @param {string} prefix - marker to apply.
     * @param {string} raw - current document title.
     * @returns {string} the title to write.
     */
    function composeTitle(prefix, raw) {
      return prefix + stripOwnPrefix(raw)
    }

    /**
     * Which marker leads the title.
     *
     * The four rules are ordered by urgency: a pending answer comes first —
     * it is usually one click and blocks the Thread until then — followed by
     * work in progress, a failure, and the softer completion reminder.
     *
     * @param {object} state - current facts.
     * @param {boolean} state.running - any Thread is working.
     * @param {boolean} state.pending - any Thread awaits user interaction.
     * @param {boolean} state.unread - any Thread finished unread (the green dot).
     * @param {readonly {at: number, error: boolean}[]} state.stops - stops observed while away.
     * @returns {string} the prefix, or '' for a quiet title.
     */
    function titlePrefix({ running, pending, unread, stops }) {
      if (pending) return PENDING_PREFIX
      if (running) return RUNNING_PREFIX
      if (stops.some(stop => stop.error)) return ERROR_PREFIX
      if (unread || stops.length > 0) return DONE_PREFIX
      return ''
    }

    /**
     * The sound slot a title marker belongs to.
     * @param {string} prefix - title marker, or ''.
     * @returns {'pending'|'running'|'error'|'done'|null} sound state, or null when quiet.
     */
    function soundStateOf(prefix) {
      if (prefix === PENDING_PREFIX) return 'pending'
      if (prefix === RUNNING_PREFIX) return 'running'
      if (prefix === ERROR_PREFIX) return 'error'
      if (prefix === DONE_PREFIX) return 'done'
      return null
    }

    /**
     * Ids that were running at the previous reading and are not running now.
     * @param {ReadonlySet<string>} previous - running ids from the previous reading.
     * @param {ReadonlySet<string>} running - running ids from this reading.
     * @returns {string[]} ids that stopped.
     */
    function stoppedSince(previous, running) {
      const stopped = []
      for (const id of previous) {
        if (!running.has(id)) stopped.push(id)
      }
      return stopped
    }

    /**
     * Interaction keys that were not pending at the previous reading.
     *
     * A pending approval, plan review or question keeps the title marker at 🟠
     * for its whole life, so the marker alone cannot tell one request from the
     * next — and every request deserves its own notification. The interaction
     * keys can tell them apart.
     *
     * @param {ReadonlySet<string>|undefined} previous - pending keys from the previous reading.
     * @param {ReadonlySet<string>} current - pending keys now.
     * @returns {string[]} keys that appeared since; empty on the first reading.
     */
    function newPendingKeys(previous, current) {
      if (previous === undefined) return []
      const added = []
      for (const key of current) {
        if (!previous.has(key)) added.push(key)
      }
      return added
    }

    /**
     * Whether a Session's last turn failed at (or just before) the given stop.
     * @param {{at: number, reason: string, code?: string}|undefined} outcome - host turn outcome.
     * @param {number} stopAt - when the stop was observed, Unix epoch ms.
     * @returns {boolean} true when a failure explains this stop.
     */
    function stopWasError(outcome, stopAt) {
      if (outcome === null || typeof outcome !== 'object' || outcome.reason !== 'error') return false
      if (typeof outcome.at !== 'number' || typeof stopAt !== 'number') return false
      const delta = stopAt - outcome.at
      return delta >= -ERROR_LEAD_MS && delta <= ERROR_WINDOW_MS
    }

    /**
     * Whether the page is away from the user's attention.
     * @returns {boolean} true when hidden or unfocused.
     */
    function isAway() {
      if (typeof document === 'undefined') return false
      if (document.visibilityState === 'hidden') return true
      return typeof document.hasFocus === 'function' ? !document.hasFocus() : false
    }

    /**
     * Own the browser title: apply a marker, keep it applied when the layout
     * rewrites the title, and restore the bare title on disposal.
     * @returns {{set: (prefix: string) => void, refresh: () => void, dispose: () => void}} controller.
     */
    function createTitleController() {
      let prefix = ''
      let writing = false
      let observer = null
      const apply = () => {
        if (typeof document === 'undefined' || typeof document.title !== 'string') return
        const next = composeTitle(prefix, document.title)
        if (document.title === next) return
        writing = true
        try {
          document.title = next
        } finally {
          writing = false
        }
      }
      if (typeof document !== 'undefined' && document.head !== null && typeof MutationObserver !== 'undefined') {
        // The layout writes the base title directly; re-apply the marker right
        // after it, so a Session switch never shows a bare title.
        observer = new MutationObserver(() => { if (!writing) apply() })
        observer.observe(document.head, { subtree: true, childList: true, characterData: true })
      }
      return {
        set(next) {
          prefix = next
          apply()
        },
        refresh() {
          apply()
        },
        dispose() {
          if (observer !== null) {
            observer.disconnect()
            observer = null
          }
          prefix = ''
          apply()
        },
      }
    }

    /** IndexedDB database holding the sound choices of this browser. */
    const DB_NAME = 'dsh-title-indicator'
    /** One object store is enough: a mute flag and one blob per state. */
    const DB_STORE = 'settings'

    /**
     * Small promise wrapper over IndexedDB, the only storage that holds a file
     * blob without inflating it into localStorage strings.
     * @returns {{read: Function, write: Function, remove: Function}} store.
     */
    function createIdbStore() {
      let database = null
      const open = () => {
        if (database !== null) return Promise.resolve(database)
        return new Promise((resolve, reject) => {
          if (typeof indexedDB === 'undefined') {
            reject(new Error('indexedDB is unavailable'))
            return
          }
          const request = indexedDB.open(DB_NAME, 1)
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
          }
          request.onsuccess = () => {
            database = request.result
            resolve(database)
          }
          request.onerror = () => { reject(request.error) }
        })
      }
      return {
        async read(key) {
          const db = await open()
          return new Promise((resolve, reject) => {
            const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key)
            request.onsuccess = () => { resolve(request.result) }
            request.onerror = () => { reject(request.error) }
          })
        },
        async write(key, value) {
          const db = await open()
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite')
            transaction.objectStore(DB_STORE).put(value, key)
            transaction.oncomplete = () => { resolve() }
            transaction.onerror = () => { reject(transaction.error) }
          })
        },
        async remove(key) {
          const db = await open()
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(DB_STORE, 'readwrite')
            transaction.objectStore(DB_STORE).delete(key)
            transaction.oncomplete = () => { resolve() }
            transaction.onerror = () => { reject(transaction.error) }
          })
        },
      }
    }

    /**
     * Play one source through a detached Audio element.
     * @param {string} source - same-origin URL or blob URL.
     * @param {number} [volume] - 0–1 playback volume.
     * @returns {() => void} stops the playback.
     */
    function defaultPlayAudio(source, volume) {
      if (typeof Audio !== 'function') return () => {}
      const audio = new Audio(source)
      try {
        audio.volume = typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : 1
      } catch {
        // A detached element keeps its default volume.
      }
      void audio.play().catch(() => {
        // Autoplay may be refused before the first user gesture; silence is fine.
      })
      return () => {
        try {
          audio.pause()
          audio.currentTime = 0
        } catch {
          // A closed or detached element needs no cleanup.
        }
      }
    }

    /** File extensions the picker offers and this code accepts. */
    const SOUND_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'flac', 'weba', 'webm']

    /** Media types a browser usually decodes, used when a file type is declared. */
    const SOUND_MEDIA_TYPES = new Set([
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg',
      'audio/opus', 'audio/mp4', 'audio/flac', 'audio/x-flac', 'audio/webm',
    ])

    /** Media type used when a file only declares a known extension. */
    const MEDIA_TYPE_BY_EXTENSION = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      flac: 'audio/flac',
      weba: 'audio/webm',
      webm: 'audio/webm',
    }

    /** The `accept` attribute of the picker: formats and types worth offering. */
    const ACCEPT_AUDIO = SOUND_EXTENSIONS.map(extension => '.' + extension)
      .concat([...SOUND_MEDIA_TYPES])
      .join(',')

    /**
     * Ask the browser whether it can decode a source.
     *
     * Metadata is enough: a container it cannot decode never reaches
     * `loadedmetadata`, which is exactly the ADPCM case. The timeout keeps a
     * wedged decoder from blocking the settings card forever.
     *
     * @param {string} source - blob or data URL.
     * @returns {Promise<boolean>} true when the browser reports audio metadata.
     */
    function defaultProbe(source) {
      if (typeof Audio !== 'function') return Promise.resolve(false)
      return new Promise((resolve) => {
        const audio = new Audio()
        let settled = false
        const finish = (ok) => {
          if (settled) return
          settled = true
          resolve(ok)
        }
        const timer = setTimeout(() => { finish(false) }, 5000)
        audio.addEventListener('loadedmetadata', () => { clearTimeout(timer); finish(true) }, { once: true })
        audio.addEventListener('error', () => { clearTimeout(timer); finish(false) }, { once: true })
        try {
          audio.src = source
        } catch {
          clearTimeout(timer)
          finish(false)
        }
      })
    }

    /**
     * Pre-screen a chosen file by its declared type and extension.
     * @param {{name?: string, type?: string}} file - selected file.
     * @returns {{name: string, type: string}|null} normalized facts, or null when unsupported.
     */
    function describeAudioFile(file) {
      const name = typeof file.name === 'string' && file.name.length > 0 ? file.name : ''
      const dot = name.lastIndexOf('.')
      const extension = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
      const declared = typeof file.type === 'string' ? file.type.toLowerCase() : ''
      if (!SOUND_MEDIA_TYPES.has(declared) && !SOUND_EXTENSIONS.includes(extension)) return null
      const type = SOUND_MEDIA_TYPES.has(declared)
        ? declared
        : (MEDIA_TYPE_BY_EXTENSION[extension] ?? 'audio/mpeg')
      return { name: name.length > 0 ? name : 'sound.' + (extension || 'mp3'), type }
    }

    /**
     * Owns the sound choices and the transition playback.
     *
     * Settings are per browser: the mute flag, the volume and one audio blob per
     * state live in IndexedDB. The done state has a built-in sound from
     * {@link DEFAULT_SOUNDS}; every other state stays silent until the user picks
     * a file for it. The manager is deliberately injectable so the package test
     * can drive it without a browser.
     *
     * @param {object} [services] - test seams.
     * @param {object} [services.store] - read/write/remove backend.
     * @param {(source: string, volume: number) => (() => void)} [services.playAudio] - playback backend.
     * @param {(source: string) => Promise<boolean>} [services.probe] - decoder probe backend.
     * @returns {object} sound manager.
     */
    function createSoundManager(services = {}) {
      const store = services.store ?? createIdbStore()
      const playAudio = services.playAudio ?? defaultPlayAudio
      const probe = services.probe ?? defaultProbe

      const listeners = new Set()
      const custom = {}
      let muted = false
      let volume = 1
      let ready = false
      let currentStop = null

      const buildSnapshot = () => {
        const customNames = {}
        const builtIn = {}
        for (const state of SOUND_STATES) {
          customNames[state] = typeof custom[state]?.name === 'string' ? custom[state].name : null
          builtIn[state] = typeof DEFAULT_SOUNDS[state] === 'string'
        }
        return Object.freeze({ ready, muted, volume, custom: customNames, defaults: builtIn })
      }

      let snapshot = buildSnapshot()
      const publish = () => {
        snapshot = buildSnapshot()
        for (const listener of listeners) listener(snapshot)
      }

      const stopCurrent = () => {
        if (currentStop !== null) {
          currentStop()
          currentStop = null
        }
      }

      const load = async () => {
        try {
          muted = (await store.read('muted')) === true
          const storedVolume = await store.read('volume')
          if (typeof storedVolume === 'number' && storedVolume >= 0 && storedVolume <= 1) volume = storedVolume
          for (const state of SOUND_STATES) {
            const value = await store.read(state)
            if (value !== null && typeof value === 'object' && value.bytes instanceof ArrayBuffer) {
              custom[state] = value
            }
          }
        } catch {
          // Private mode or a blocked store: the choices stay session-only.
        }
        ready = true
        publish()
      }

      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        getSnapshot() {
          return snapshot
        },
        load,
        setMuted(value) {
          muted = value === true
          void store.write('muted', muted).catch(() => {})
          publish()
        },
        setVolume(value) {
          const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 1
          // The card steps in tenths; keep the stored value on the same grid.
          volume = Math.round(Math.min(1, Math.max(0, numeric)) * 10) / 10
          void store.write('volume', volume).catch(() => {})
          publish()
        },
        /**
         * Validate and store one picked file.
         * @param {string} state - sound slot.
         * @param {File} file - picked file.
         * @returns {Promise<{ok: boolean, reason?: string}>} outcome for the card.
         */
        async setCustom(state, file) {
          if (!SOUND_STATES.includes(state) || file === null || typeof file !== 'object') {
            return { ok: false, reason: 'invalid' }
          }
          const described = describeAudioFile(file)
          if (described === null) return { ok: false, reason: 'unsupported' }
          const bytes = await file.arrayBuffer()
          if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return { ok: false, reason: 'empty' }
          // The extension only predicts; let the decoder be the judge.
          if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            let source
            let decoded = false
            try {
              source = URL.createObjectURL(new Blob([bytes], { type: described.type }))
              decoded = await probe(source)
            } catch {
              decoded = false
            } finally {
              if (source !== undefined) {
                try {
                  URL.revokeObjectURL(source)
                } catch {
                  // Already revoked.
                }
              }
            }
            if (!decoded) return { ok: false, reason: 'decode' }
          }
          custom[state] = { name: described.name, type: described.type, bytes }
          void store.write(state, custom[state]).catch(() => {})
          publish()
          return { ok: true }
        },
        clearCustom(state) {
          if (!SOUND_STATES.includes(state)) return
          delete custom[state]
          void store.remove(state).catch(() => {})
          publish()
        },
        play(state, options = {}) {
          if (!SOUND_STATES.includes(state)) return
          if (options.force !== true && muted) return
          const entry = custom[state]
          // A picked file wins; otherwise the state's built-in sound, if any.
          if (entry === undefined) {
            const fallback = DEFAULT_SOUNDS[state]
            if (typeof fallback !== 'string') return
            stopCurrent()
            currentStop = playAudio(fallback, volume)
            return
          }
          if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
          const source = URL.createObjectURL(new Blob([entry.bytes], { type: entry.type }))
          stopCurrent()
          const stop = playAudio(source, volume)
          currentStop = () => {
            stop()
            try {
              URL.revokeObjectURL(source)
            } catch {
              // Already revoked.
            }
          }
        },
        dispose() {
          stopCurrent()
          listeners.clear()
        },
      }
    }

    /**
     * Frame-wide title projection. Renders nothing; every render only derives
     * facts that the effects project into the document title and the sounds.
     * @param {object} props - composed overlay props plus the injected controller and sounds.
     * @returns {null} no content.
     */
    function TitleIndicator(props) {
      const title = props.title
      const sounds = props.sounds
      const byId = props.useSessions(state => state.byId)
      const statuses = props.useSessionStatus(snapshot => snapshot)
      const [outcomes, setOutcomes] = useState({})
      const [stops, setStops] = useState(() => new Map())
      const [, setTick] = useState(0)
      const previousRunning = useRef(new Set())
      const soundState = useRef(undefined)

      // Poll the host's turn outcomes; the same tick guarantees the title is
      // re-asserted at least every two seconds.
      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const response = await fetch(STATUS_URL, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            if (!response.ok) return
            const type = response.headers.get('content-type') ?? ''
            if (!type.includes('json')) return
            const body = await response.json()
            if (!alive) return
            if (body === null || typeof body !== 'object') return
            if (body.sessions === null || typeof body.sessions !== 'object') return
            setOutcomes(body.sessions)
          } catch {
            // The host half may be reloading; keep the last picture.
          }
        }
        void load()
        const timer = setInterval(() => {
          void load()
          title.refresh()
          setTick(tick => tick + 1)
        }, REFRESH_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [title])

      // Running now: the unified status snapshot plus the list rows, which
      // together cover retained Sessions and catalog rows alike.
      const running = new Set()
      let pending = false
      for (const [id, status] of statuses) {
        if (status.running === true) running.add(id)
        if (status.pendingInteraction !== undefined) pending = true
      }
      for (const id of Object.keys(byId)) {
        if (byId[id] !== undefined && byId[id].running === true) running.add(id)
      }
      const unread = [...statuses.values()].some(status => status.completionUnread === true)

      // Fold transitions into the away-stop set. Only a stop observed while the
      // page is hidden or unfocused is news the title has to carry.
      useEffect(() => {
        const previous = previousRunning.current
        previousRunning.current = running
        const stopped = stoppedSince(previous, running)
        if (stopped.length === 0 || !isAway()) return
        const at = Date.now()
        setStops((current) => {
          const next = new Map(current)
          for (const id of stopped) next.set(id, at)
          return next
        })
      }, [statuses, byId])

      // Regaining attention acknowledges every stop, which clears the failure
      // and completion markers.
      useEffect(() => {
        const acknowledge = () => {
          if (isAway()) return
          setStops((current) => (current.size === 0 ? current : new Map()))
        }
        window.addEventListener('focus', acknowledge)
        document.addEventListener('visibilitychange', acknowledge)
        return () => {
          window.removeEventListener('focus', acknowledge)
          document.removeEventListener('visibilitychange', acknowledge)
        }
      }, [])

      // Every new pending interaction rings the pending sound, even while the
      // marker stays 🟠 for the previous one. The first reading only seeds the
      // set: opening the page must not fire for a request that was already there.
      const pendingKeys = useRef(undefined)
      useEffect(() => {
        const keys = new Set()
        for (const status of statuses.values()) {
          const interaction = status.pendingInteraction
          if (interaction !== undefined && typeof interaction.key === 'string') keys.add(interaction.key)
        }
        const added = newPendingKeys(pendingKeys.current, keys)
        pendingKeys.current = keys
        if (added.length > 0) sounds.play('pending')
      }, [statuses, sounds])

      const stopList = [...stops.entries()].map(([id, at]) => ({ at, error: stopWasError(outcomes[id], at) }))
      const prefix = titlePrefix({ running: running.size > 0, pending, unread, stops: stopList })
      useEffect(() => { title.set(prefix) }, [prefix, title])

      // One sound per state change for the three aggregate states. Pending is
      // handled by the interaction-key watcher above, which fires for every new
      // request instead of only when the marker appears.
      useEffect(() => {
        const next = soundStateOf(prefix)
        if (soundState.current === undefined) {
          soundState.current = next
          return
        }
        if (next === soundState.current) return
        soundState.current = next
        if (next !== null && next !== 'pending') sounds.play(next)
      }, [prefix, sounds])

      // Leaving the tree (shell teardown) restores the bare title.
      useEffect(() => () => { title.set('') }, [title])

      return null
    }

    /**
     * The Sounds settings card: one row per title state.
     * @param {object} props - section props plus the injected sound manager.
     * @returns {object} the section element tree.
     */
    /** Human-readable reason a picked file was refused. */
    const REJECTION_TEXT = {
      unsupported: 'Unsupported file type — use MP3, WAV (PCM), OGG, M4A or FLAC.',
      decode: 'This file cannot be decoded in this browser (ADPCM WAV is not supported).',
      empty: 'The selected file is empty.',
      invalid: 'The file could not be read.',
    }

    function SoundSettings(props) {
      const sounds = props.sounds
      const [snapshot, setSnapshot] = useState(() => sounds.getSnapshot())
      const [errors, setErrors] = useState({})
      const fileInput = useRef(null)
      const pickTarget = useRef(null)

      useEffect(() => sounds.subscribe(setSnapshot), [sounds])

      const pick = (state) => {
        pickTarget.current = state
        const input = fileInput.current
        if (input !== null) input.click()
      }

      const sourceOf = (state) => {
        const name = snapshot.custom[state]
        if (name !== null) return 'Custom: ' + name
        return snapshot.defaults[state] ? 'Built-in sound' : 'No sound yet'
      }

      const row = (entry) => h('div', { key: entry.state, className: 'dsh-sounds-row' },
        h('span', { className: 'dsh-sounds-emoji', 'aria-hidden': 'true' }, entry.emoji),
        h('span', { className: 'dsh-sounds-text' },
          h('span', { className: 'dsh-sounds-label' }, entry.label),
          h('span', { className: 'dsh-sounds-source' }, sourceOf(entry.state)),
          errors[entry.state] === undefined
            ? null
            : h('span', { className: 'dsh-sounds-error', role: 'alert' }, errors[entry.state]),
        ),
        h('span', { className: 'dsh-sounds-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-sounds-button',
            onClick: () => { pick(entry.state) },
          }, 'Choose file…'),
          h('button', {
            type: 'button',
            className: 'dsh-sounds-button',
            disabled: snapshot.custom[entry.state] === null && snapshot.defaults[entry.state] !== true,
            onClick: () => { sounds.play(entry.state, { force: true }) },
          }, 'Test'),
          h('button', {
            type: 'button',
            className: 'dsh-sounds-button',
            disabled: snapshot.custom[entry.state] === null,
            onClick: () => { sounds.clearCustom(entry.state) },
          }, 'Reset'),
        ),
      )

      return h('div', { className: 'dsh-sounds' },
        h('div', { className: 'dsh-sounds-head' },
          h('div', null,
            h('h3', { className: 'dsh-sounds-title' }, 'Sounds'),
            h('p', { className: 'dsh-sounds-description' },
              'Play a short sound when a thread changes state. A sound fires when the state appears, not on every refresh.'),
          ),
        ),
        h('div', { className: 'dsh-sounds-controls' },
            h('label', { className: 'dsh-sounds-volume' },
              h('span', null, 'Volume'),
              h('input', {
                type: 'range',
                min: 0,
                max: 100,
                step: 10,
                value: String(Math.round(snapshot.volume * 100)),
                'aria-label': 'Sound volume',
                onChange: (event) => { sounds.setVolume(Number(event.target.value) / 100) },
              }),
              h('span', { className: 'dsh-sounds-volume-value' }, Math.round(snapshot.volume * 100) + '%'),
            ),
            h('label', { className: 'dsh-sounds-mute' },
              h('input', {
                type: 'checkbox',
                checked: snapshot.muted,
                onChange: (event) => { sounds.setMuted(event.target.checked) },
              }),
              'Mute all sounds',
            ),
        ),
        h('input', {
          ref: fileInput,
          type: 'file',
          accept: ACCEPT_AUDIO,
          style: { display: 'none' },
          onChange: (event) => {
            const file = event.target.files !== null && event.target.files.length > 0 ? event.target.files[0] : null
            const state = pickTarget.current
            event.target.value = ''
            if (file === null || state === null) return
            void sounds.setCustom(state, file).then((result) => {
              if (result !== null && result.ok === true) {
                setErrors((current) => {
                  if (current[state] === undefined) return current
                  const next = { ...current }
                  delete next[state]
                  return next
                })
                sounds.play(state, { force: true })
                return
              }
              const reason = result !== null && typeof result === 'object' && typeof result.reason === 'string'
                ? result.reason
                : 'invalid'
              setErrors((current) => ({ ...current, [state]: REJECTION_TEXT[reason] ?? REJECTION_TEXT.invalid }))
            })
          },
        }),
        h('div', { className: 'dsh-sounds-rows' }, SOUND_ROWS.map(row)),
        h('p', { className: 'dsh-sounds-footnote' },
          'The done state ships with a built-in sound; the others stay silent until you pick a file. '
          + '“Choose file…” accepts MP3, WAV (PCM), OGG, M4A and FLAC and keeps the choice in this browser; '
          + 'a file the browser cannot decode is refused. “Reset” returns to the built-in sound, if there is one; '
          + 'Test plays even while muted.'),
      )
    }

    /**
     * Seat the title projection and the Sounds section, and own their
     * controller and sound manager for the plugin lifetime.
     * @param {object} ctx - client Context carrying `slots`.
     */
    function apply(ctx) {
      const title = createTitleController()
      const sounds = createSoundManager()
      ctx.effect(() => () => {
        title.dispose()
        sounds.dispose()
      }, 'title-indicator: browser title and sounds')
      void sounds.load()
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'title-indicator',
        inject: () => ({ title, sounds }),
      }, TitleIndicator))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'title-indicator',
        order: 30,
        label: () => 'Sounds',
        inject: () => ({ sounds }),
      }, SoundSettings))
    }

    exports.name = 'title-indicator'
    exports.inject = ['slots']
    exports.apply = apply
    // Exported for the package's own unit test; not part of the UI contract.
    exports.PREFIXES = PREFIXES
    exports.SOUND_STATES = SOUND_STATES
    exports.SOUND_ROWS = SOUND_ROWS
    exports.stripOwnPrefix = stripOwnPrefix
    exports.composeTitle = composeTitle
    exports.titlePrefix = titlePrefix
    exports.soundStateOf = soundStateOf
    exports.newPendingKeys = newPendingKeys
    exports.stoppedSince = stoppedSince
    exports.stopWasError = stopWasError
    exports.isAway = isAway
    exports.createTitleController = createTitleController
    exports.createSoundManager = createSoundManager
    exports.describeAudioFile = describeAudioFile
    exports.ACCEPT_AUDIO = ACCEPT_AUDIO
    exports.DEFAULT_SOUNDS = DEFAULT_SOUNDS

    return module.exports
  },
})
