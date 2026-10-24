/**
 * Host half of dsh-title-indicator.
 *
 * The client can see whether a Session runs, waits for the user, or finished
 * unread — but not *why* a turn stopped. This half keeps one small fact per
 * Session, the last committed `turn/end` reason, and serves it as JSON for the
 * title component to read. A failure (including a depleted API balance) arrives
 * here as `reason.kind === 'error'` with the provider-neutral code, so the tab
 * title can distinguish "finished" from "broke".
 *
 * The module stays dependency-free on purpose: a plugin installed by path into a
 * profile resolves no Harness package names of its own, and the services it needs
 * arrive through `inject`.
 */

/** Exact route carrying the last `turn/end` outcome per Session. */
export const STATUS_PATH = '/plugins/dsh-title-indicator/status'

/** Upper bound on remembered Sessions; oldest outcomes leave first. */
const MAX_SESSIONS = 512

/**
 * Read one turn-end reason into the wire shape.
 * @param {unknown} event - the committed `turn/end` session event.
 * @returns {{at: number, reason: string, code?: string}|null} outcome, or null when unusable.
 */
export function turnOutcome(event) {
  if (event === null || typeof event !== 'object' || event.type !== 'turn/end') return null
  const data = event.data
  const reason = data !== null && typeof data === 'object' ? data.reason : undefined
  if (reason === null || typeof reason !== 'object') return null
  const outcome = {
    at: typeof event.time === 'number' ? event.time : Date.now(),
    reason: typeof reason.kind === 'string' ? reason.kind : 'unknown',
  }
  if (reason.error !== null && typeof reason.error === 'object'
    && typeof reason.error.code === 'string' && reason.error.code.length > 0) {
    outcome.code = reason.error.code
  }
  return outcome
}

export const name = 'title-indicator'
export const inject = ['webServer']

/**
 * Track the latest `turn/end` per Session and serve it to the browser.
 * @param {object} ctx - host Context carrying `webServer`.
 */
export function apply(ctx) {
  /** @type {Map<string, {at: number, reason: string, code?: string}>} */
  const outcomes = new Map()

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    const outcome = turnOutcome(event)
    if (outcome === null) return
    const id = String(session.id)
    // Re-insert so insertion order stays "least recently finished first".
    outcomes.delete(id)
    outcomes.set(id, outcome)
    while (outcomes.size > MAX_SESSIONS) {
      const oldest = outcomes.keys().next()
      if (oldest.done === true) break
      outcomes.delete(oldest.value)
    }
  }), 'title-indicator: turn outcomes')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      const body = JSON.stringify({ at: Date.now(), sessions: Object.fromEntries(outcomes) })
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'title-indicator: outcome route')
}
