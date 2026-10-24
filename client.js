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
     * state live in IndexedDB. No sound ships with the package, so a state stays
     * silent until the user picks a file for it. The manager is deliberately
     * injectable so the package test can drive it without a browser.
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
        for (const state of SOUND_STATES) {
          customNames[state] = typeof custom[state]?.name === 'string' ? custom[state].name : null
        }
        return Object.freeze({ ready, muted, volume, custom: customNames })
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
          // No sound ships with the package: silence until a file is picked.
          if (entry === undefined) return
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
        return name === null ? 'No sound yet' : 'Custom: ' + name
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
            disabled: snapshot.custom[entry.state] === null,
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
          'No sound ships with the plugin: pick a file for the states you care about. '
          + '“Choose file…” accepts MP3, WAV (PCM), OGG, M4A and FLAC and keeps the choice in this browser; '
          + 'a file the browser cannot decode is refused. “Reset” clears the choice; Test plays even while muted.'),
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

    return module.exports
  },
})
