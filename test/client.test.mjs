/**
 * Unit test for both halves of dsh-title-indicator. Runs without a browser, a
 * network, or a test framework: the browser half is evaluated in a VM with a
 * fake module table, a fake React, and a fake document; the host half runs
 * against a fake Context, its real `sounds/` directory, and fake responses.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'

import { STATUS_PATH, apply as applyHost, turnOutcome } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = resolve(here, '..', 'client.js')

// ---------------------------------------------------------------- client half

const reactStub = {
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  createElement: () => null,
}

class FakeBlob {
  constructor(parts, options) {
    this.parts = parts
    this.type = options?.type
  }
}

const fakeDocument = {
  title: 'Session — DSH Local Build',
  head: { appendChild: () => {} },
  visibilityState: 'visible',
  hasFocus: () => true,
  querySelector: () => null,
  createElement: () => ({ dataset: {} }),
}

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        sandbox.registration = definition
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  document: fakeDocument,
  Blob: FakeBlob,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
  console,
}
const context = createContext(sandbox)
runInContext(readFileSync(bundlePath, 'utf8'), context, { filename: bundlePath })
const registration = sandbox.registration

assert.equal(registration.id, 'dsh-title-indicator', 'bundle registers its package id')
assert.equal(typeof registration.factory, 'function', 'bundle exposes a closure factory')

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return reactStub
  throw new Error('unexpected module request: ' + specifier)
})

assert.equal(plugin.name, 'title-indicator')
assert.equal(plugin.inject.join(','), 'slots')
assert.equal(typeof plugin.apply, 'function')

// The marker is a prefix on the layout's title, and stripping is idempotent.
assert.equal(plugin.composeTitle('🕐 ', 'Session — DSH Local Build'), '🕐 Session — DSH Local Build')
assert.equal(plugin.composeTitle('', '🕐 Session — DSH Local Build'), 'Session — DSH Local Build')
assert.equal(plugin.composeTitle('🟠 ', '🕐 Session — DSH Local Build'), '🟠 Session — DSH Local Build')
assert.equal(plugin.composeTitle('⚠️ ', '⚠️ Session'), '⚠️ Session')
assert.equal(plugin.stripOwnPrefix('Session'), 'Session')

// Four rules, in urgency order: a pending click first, then work, failure, reminder.
const quiet = { running: false, pending: false, unread: false, stops: [] }
assert.equal(plugin.titlePrefix({ ...quiet, pending: true }), '🟠 ')
assert.equal(plugin.titlePrefix({ ...quiet, pending: true, running: true }), '🟠 ', 'a pending click outranks running work')
assert.equal(plugin.titlePrefix({ ...quiet, pending: true, stops: [{ at: 1, error: true }] }), '🟠 ', 'a pending click outranks a failure')
assert.equal(plugin.titlePrefix({ ...quiet, pending: true, unread: true }), '🟠 ', 'a pending click outranks a reminder')
assert.equal(plugin.titlePrefix({ ...quiet, running: true }), '🕐 ')
assert.equal(plugin.titlePrefix({ ...quiet, running: true, stops: [{ at: 1, error: true }] }), '🕐 ', 'work outranks a failure')
assert.equal(plugin.titlePrefix({ ...quiet, stops: [{ at: 1, error: true }] }), '⚠️ ')
assert.equal(plugin.titlePrefix({ ...quiet, stops: [{ at: 1, error: true }], unread: true }), '⚠️ ', 'a failure outranks a reminder')
assert.equal(plugin.titlePrefix({ ...quiet, unread: true }), '✅ ')
assert.equal(plugin.titlePrefix({ ...quiet, stops: [{ at: 1, error: false }] }), '✅ ', 'a watched stop is still news')
assert.equal(plugin.titlePrefix(quiet), '', 'nothing to say leaves the title alone')

// Each marker maps to one sound slot, and quiet maps to none.
assert.equal(plugin.soundStateOf('🟠 '), 'pending')
assert.equal(plugin.soundStateOf('🕐 '), 'running')
assert.equal(plugin.soundStateOf('⚠️ '), 'error')
assert.equal(plugin.soundStateOf('✅ '), 'done')
assert.equal(plugin.soundStateOf(''), null)
assert.deepEqual([...plugin.SOUND_ROWS.map(row => row.state)], [...plugin.SOUND_STATES])
assert.equal(plugin.DEFAULT_SOUNDS.done.startsWith('data:audio/mpeg;base64,'), true, 'the done sound ships inside the bundle')
assert.equal(plugin.DEFAULT_SOUNDS.pending, undefined, 'the other states ship no sound')

// Every new pending interaction earns its own notification.
assert.deepEqual([...plugin.newPendingKeys(undefined, new Set(['a']))], [], 'the first reading is silent')
assert.deepEqual([...plugin.newPendingKeys(new Set(['a']), new Set(['a', 'b']))], ['b'])
assert.deepEqual([...plugin.newPendingKeys(new Set(['a']), new Set(['a']))], [], 'a request that is still pending does not ring again')
assert.deepEqual([...plugin.newPendingKeys(new Set(['a']), new Set(['a', 'b', 'c']))].sort(), ['b', 'c'])
assert.deepEqual([...plugin.newPendingKeys(new Set(['a', 'b']), new Set(['a']))], [], 'resolving a request is not news')

// Stop detection only reports ids that left the running set.
const previous = new Set(['a', 'b', 'c'])
const running = new Set(['b'])
assert.deepEqual([...plugin.stoppedSince(previous, running)].sort(), ['a', 'c'])
assert.deepEqual([...plugin.stoppedSince(new Set(), new Set())], [])

// A failed turn explains a stop inside the window, never a later unrelated one.
const failedTurn = { at: 1_000_000, reason: 'error', code: 'QUOTA' }
assert.equal(plugin.stopWasError(failedTurn, 1_000_500), true)
assert.equal(plugin.stopWasError(failedTurn, 1_059_000), true)
assert.equal(plugin.stopWasError(failedTurn, 1_100_000), false, 'an old failure does not explain a new stop')
assert.equal(plugin.stopWasError(failedTurn, 990_000), false, 'a stop before the failure is not explained by it')
assert.equal(plugin.stopWasError({ at: 1_000_000, reason: 'completed' }, 1_000_000), false)
assert.equal(plugin.stopWasError(undefined, 1_000_000), false)

// The controller owns the title and restores it.
const controller = plugin.createTitleController()
controller.set('🕐 ')
assert.equal(fakeDocument.title, '🕐 Session — DSH Local Build')
controller.set('⚠️ ')
assert.equal(fakeDocument.title, '⚠️ Session — DSH Local Build', 'a new marker replaces the old one')
controller.refresh()
assert.equal(fakeDocument.title, '⚠️ Session — DSH Local Build', 'refresh is idempotent')
controller.dispose()
assert.equal(fakeDocument.title, 'Session — DSH Local Build', 'disposal strips the marker')

// Sound manager: defaults, mute, force, custom files and reset.
const stored = new Map()
const store = {
  async read(key) { return stored.get(key) },
  async write(key, value) { stored.set(key, value) },
  async remove(key) { stored.delete(key) },
}
const starts = []
const volumes = []
let stops = 0
const manager = plugin.createSoundManager({
  store,
  playAudio: (source, volume) => {
    starts.push(source)
    volumes.push(volume)
    return () => { stops += 1 }
  },
  probe: async () => true,
})
await manager.load()
assert.equal(manager.getSnapshot().ready, true)
assert.deepEqual({ ...manager.getSnapshot().muted }, { pending: false, running: false, error: false, done: false })
assert.deepEqual({ ...manager.getSnapshot().volumes }, { pending: 1, running: 1, error: 1, done: 1 })
assert.deepEqual([...Object.keys(manager.getSnapshot().custom)], [...plugin.SOUND_STATES])
assert.equal([...Object.values(manager.getSnapshot().custom)].every(name => name === null), true, 'nothing is configured yet')
assert.equal(manager.getSnapshot().defaults.done, true, 'done has a built-in sound')
assert.equal(manager.getSnapshot().defaults.pending, false)

manager.setVolume('done', 0.3)
assert.equal(manager.getSnapshot().volumes.done, 0.3)
assert.equal(stored.get('volume.done'), 0.3)
assert.equal(manager.getSnapshot().volumes.pending, 1, 'the other states keep their own volume')
manager.setVolume('done', 0.34)
assert.equal(manager.getSnapshot().volumes.done, 0.3, 'the stored value stays on the card\'s tenth grid')
manager.setVolume('done', 4)
assert.equal(manager.getSnapshot().volumes.done, 1, 'volume is clamped to 0..1')

manager.setVolume('done', 0.3)
manager.play('pending')
assert.equal(starts.length, 0, 'a state without a built-in sound stays silent')
manager.play('done')
assert.equal(starts.length, 1, 'the done state plays its built-in sound')
assert.equal(starts[0].startsWith('data:audio/mpeg;base64,'), true)
assert.equal(volumes[0], 0.3, 'playback carries that state\'s volume')

manager.setMuted('pending', true)
assert.equal(manager.getSnapshot().muted.pending, true)
assert.equal(manager.getSnapshot().muted.done, false, 'muting one state leaves the others alone')
assert.equal(stored.get('muted.pending'), true)
manager.play('pending')
assert.equal(starts.length, 1, 'mute suppresses that state\'s playback')
manager.play('done')
assert.equal(starts.length, 2, 'an un-muted state still plays while another is muted')
manager.play('done', { force: true })
assert.equal(starts.length, 3, 'the Test button plays even while muted')

// A picked file is screened by type and then by the browser's decoder.
assert.equal(plugin.describeAudioFile({ name: 'notes.txt', type: 'text/plain' }), null)
assert.equal(plugin.describeAudioFile({ name: 'chicken.wav', type: 'audio/wav' }).type, 'audio/wav')
assert.equal(plugin.describeAudioFile({ name: 'x.OGG', type: '' }).type, 'audio/ogg')
assert.equal(plugin.describeAudioFile({ name: 'x', type: 'audio/mpeg' }).name, 'x')
assert.equal(plugin.ACCEPT_AUDIO.includes('.mp3') && plugin.ACCEPT_AUDIO.includes('audio/mpeg'), true)

const bytes = runInContext('new ArrayBuffer(8)', context)
const pickyStore = new Map()
const picky = plugin.createSoundManager({
  store: {
    async read(key) { return pickyStore.get(key) },
    async write(key, value) { pickyStore.set(key, value) },
    async remove(key) { pickyStore.delete(key) },
  },
  playAudio: () => () => {},
  probe: async () => false,
})
await picky.load()
const unsupported = await picky.setCustom('pending', { name: 'notes.txt', type: 'text/plain', arrayBuffer: async () => bytes })
assert.equal(unsupported.ok, false)
assert.equal(unsupported.reason, 'unsupported')
const undecodable = await picky.setCustom('pending', { name: 'adpcm.wav', type: 'audio/wav', arrayBuffer: async () => bytes })
assert.equal(undecodable.ok, false)
assert.equal(undecodable.reason, 'decode')
assert.equal(picky.getSnapshot().custom.pending, null, 'a refused file is not stored')
const accepted = await manager.setCustom('pending', { name: 'chicken.wav', type: 'audio/wav', arrayBuffer: async () => bytes })
assert.equal(accepted.ok, true)
assert.equal(manager.getSnapshot().custom.pending, 'chicken.wav')
assert.equal(stored.get('pending').name, 'chicken.wav')

// A custom file wins over the built-in one, and the state's mute still applies.
manager.setVolume('pending', 0.6)
starts.length = 0
volumes.length = 0
stops = 0
manager.play('pending')
assert.equal(starts.length, 0, 'mute suppresses that state\'s playback')
manager.play('pending', { force: true })
assert.equal(starts.length, 1, 'the Test button plays even while muted')
assert.equal(starts[0], 'blob:test', 'a picked file plays through a blob URL')
assert.equal(volumes[0], 0.6, 'playback carries the pending volume, not another state\'s')
manager.setMuted('pending', false)
manager.play('pending')
assert.equal(starts.length, 2, 'un-muting the state brings its sound back')
assert.ok(stops >= 1, 'each new sound stops the previous one')

manager.clearCustom('pending')
assert.equal(manager.getSnapshot().custom.pending, null)
assert.equal(stored.has('pending'), false)
manager.dispose()

// Upgrading from the global pair: its values seed every state, per-state keys win.
const legacyStore = new Map([['muted', true], ['volume', 0.4], ['volume.done', 0.9]])
const legacy = plugin.createSoundManager({
  store: {
    async read(key) { return legacyStore.get(key) },
    async write(key, value) { legacyStore.set(key, value) },
    async remove(key) { legacyStore.delete(key) },
  },
  playAudio: () => () => {},
  probe: async () => true,
})
await legacy.load()
assert.equal(legacy.getSnapshot().muted.pending, true, 'the old global mute seeds each state')
assert.equal(legacy.getSnapshot().volumes.pending, 0.4, 'the old global volume seeds each state')
assert.equal(legacy.getSnapshot().volumes.done, 0.9, 'a stored per-state value wins')

// Registration: the invisible title projection and the Sounds section.
let registered
const injected = []
const clientContext = {
  effect(callback) {
    return callback()
  },
  slots: {
    inject(key, callback) {
      injected.push(key)
      return callback()
    },
    register(options, component) {
      registered = { options, component }
      return () => {}
    },
  },
}
plugin.apply(clientContext)
assert.deepEqual(injected.sort(), ['settings.section', 'shell.overlay'])
assert.equal(registered.options.name, 'settings.section')
assert.equal(registered.options.id, 'title-indicator')
assert.equal(registered.options.label(), 'Sounds')
const face = registered.options.inject()
assert.equal(typeof face.sounds.play, 'function')
assert.equal(typeof face.sounds.getSnapshot, 'function')

// ------------------------------------------------------------------ host half

const turnEnd = (reason, time = 1_000) => ({ type: 'turn/end', time, data: { turn: 1, reason } })
assert.deepEqual(turnOutcome(turnEnd({ kind: 'error', error: { code: 'QUOTA', message: 'no balance' } })), {
  at: 1_000,
  reason: 'error',
  code: 'QUOTA',
})
assert.deepEqual(turnOutcome(turnEnd({ kind: 'completed' })), { at: 1_000, reason: 'completed' })
assert.equal(turnOutcome({ type: 'turn/start', time: 1, data: { turn: 1 } }), null)
assert.equal(turnOutcome({ type: 'turn/end', time: 1, data: {} }), null)
assert.equal(turnOutcome(null), null)

const listeners = []
const disposers = []
const routes = new Map()
const hostContext = {
  on(event, listener) {
    listeners.push({ event, listener })
    return () => {}
  },
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  webServer: {
    register(route) {
      routes.set(route.kind + ' ' + route.path, route)
      return () => {}
    },
  },
}
applyHost(hostContext)
assert.ok(routes.has('exact ' + STATUS_PATH))
assert.deepEqual(routes.size, 1, 'the host half only registers the outcome route')

const sessionEvents = listeners.filter(entry => entry.event === 'session/event')
assert.equal(sessionEvents.length, 1, 'one session-event listener tracks turn outcomes')
const { listener } = sessionEvents[0]
listener({ id: 's1' }, turnEnd({ kind: 'completed' }, 2_000))
listener({ id: 's2' }, turnEnd({ kind: 'error', error: { code: 'INSUFFICIENT_BALANCE', message: 'no balance' } }, 3_000))
listener({ id: 's1' }, turnEnd({ kind: 'error', error: { code: 'QUOTA', message: 'quota' } }, 4_000))

/**
 * Run one registered route against a fake request/response pair.
 * @param {{kind: string, path: string}} route - route key.
 * @param {string} method - HTTP method.
 * @param {string} url - request target.
 * @returns {Promise<{status: number, body: unknown, headers: object}>} the answer.
 */
async function call(route, method, url = route.path) {
  const answer = { status: 0, body: '', headers: {} }
  const res = {
    writeHead(status, headers = {}) {
      answer.status = status
      answer.headers = headers
    },
    end(body) {
      answer.body = body === undefined ? '' : body
    },
  }
  await route.handler({ method, url }, res)
  return answer
}

const statusRoute = routes.get('exact ' + STATUS_PATH)
const statusAnswer = await call(statusRoute, 'GET')
assert.equal(statusAnswer.status, 200)
const snapshot = JSON.parse(statusAnswer.body)
assert.deepEqual(snapshot.sessions.s1, { at: 4_000, reason: 'error', code: 'QUOTA' }, 'the latest turn wins')
assert.deepEqual(snapshot.sessions.s2, { at: 3_000, reason: 'error', code: 'INSUFFICIENT_BALANCE' })
assert.equal((await call(statusRoute, 'POST')).status, 405)

for (const dispose of disposers) {
  if (typeof dispose === 'function') dispose()
}

console.log('dsh-title-indicator: all assertions passed')
