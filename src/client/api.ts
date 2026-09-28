/** Browser -> Host fetch face for dsh-jumpserver bridge routes. */
const HOST_BASE = (): string => {
  const location = (globalThis as { location?: { origin?: string } }).location
  const origin = location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

export interface SnapshotResponse {
  ok?: boolean
  lastSeq: number
  /** V0.3.1: oldest retained event seq (0 while empty) — lets the client
   *  detect a ring-buffer gap and warn instead of faking continuous output. */
  oldestSeq?: number
  events: Array<{
    seq: number
    timestamp: number
    type: 'input' | 'output' | 'state' | 'target' | 'error'
    data?: string
    state?: string
    prev?: string | null
    target?: string
    hostname?: string | null
    user?: string | null
    pwd?: string | null
    message?: string
  }>
  state?: string
  connected?: boolean
  enabled?: boolean
  configured?: boolean
  gateway?: string
  target?: string | null
  hostname?: string | null
  user?: string | null
  permissionMode?: string
  /** V0.2.4: whether this conversation holds a JumpServer Session Grant. */
  granted?: boolean
  /** V0.2.6 version handshake: Host plugin identity (for the sidebar header). */
  pluginVersion?: string
  hostBuild?: string
  protocolVersion?: number
  /** V0.2.6 version handshake: client identity from the bundle the browser loaded. */
  clientVersion?: string
  clientBuild?: string
}

export interface StatusResponse {
  ok?: boolean
  state?: string
  connected?: boolean
  enabled?: boolean
  configured?: boolean
  gateway?: string
  target?: string | null
  hostname?: string | null
  user?: string | null
  permissionMode?: string
  /** V0.2.4: whether this conversation holds a JumpServer Session Grant. */
  granted?: boolean
  lastSeq?: number
  /** V0.2.6 version handshake: Host plugin identity. */
  pluginVersion?: string
  hostBuild?: string
  protocolVersion?: number
  /** V0.2.7: manual terminal input policy as resolved by the host. */
  manualPolicy?: string
  /** V0.4.1: loopback console URL for this conversation (token embedded). */
  consoleUrl?: string
}

export interface TestResponse {
  ok: boolean
  code?: string
  message?: string
  gateway?: string
  user?: string
  latencyMs?: number
  state?: string
  /** V0.2.7: true when the test used the DRAFT connection params. */
  draft?: boolean
}

export interface ManualCommandResponse {
  ok: boolean
  code?: string
  message?: string
  state?: string
  target?: string | null
  hostname?: string | null
  exitCode?: number
  executionState?: string
  durationMs?: number
  /** V0.2.7: state-aware result kind: exec | leave | enter | close | assets. */
  kind?: string
  /** V0.2.7: CONFIRM_MODIFY gate requires a second confirmation for this command. */
  risk?: string
  command?: string
  /** V0.3.1: one-time confirmation challenge (single use, TTL). */
  confirmToken?: string
  commandHash?: string
  expiresAt?: number
  /** V0.2.7: menu 'p' asset rows. */
  rows?: Array<{ name?: string; ip?: string | null; platform?: string | null; node?: string | null; comment?: string | null }>
  count?: number
  reportedTotal?: number
  health?: string
  /** V0.2.7: manual policy as seen by the host. */
  manualPolicy?: string
}

/** V0.2.7: asset picker payload from /api/jumpserver.assets. */
export interface AssetsResponse {
  ok?: boolean
  code?: string
  message?: string
  count?: number
  reportedTotal?: number | null
  complete?: boolean
  health?: string
  filter?: string | null
  group?: string | null
  groupMatched?: number
  groups?: string[]
  rows?: Array<{ name?: string; ip?: string | null; platform?: string | null; node?: string | null }>
}

/** V0.2.7: recent-audit payload from /api/jumpserver.audit. */
export interface AuditResponse {
  ok?: boolean
  records?: Array<Record<string, unknown>>
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number; acceptErrorBody?: boolean } = {},
): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 20000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const upstream = options.signal
  const abortFromUpstream = (): void => controller.abort()
  if (upstream?.aborted === true) controller.abort()
  else upstream?.addEventListener('abort', abortFromUpstream, { once: true })
  try {
    const response = await fetch(HOST_BASE() + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    } as RequestInit)
    const payload = await response.json().catch(() => undefined) as T | undefined
    if (!response.ok) {
      if (options.acceptErrorBody === true && payload !== undefined) return payload
      throw new Error('HTTP ' + response.status + ' from ' + path)
    }
    if (payload === undefined) throw new Error('invalid JSON response from ' + path)
    return payload
  } finally {
    clearTimeout(timer)
    upstream?.removeEventListener('abort', abortFromUpstream)
  }
}

export function fetchSnapshot(sinceSeq: number, sessionId: string, signal?: AbortSignal): Promise<SnapshotResponse> {
  return postJson<SnapshotResponse>('/api/jumpserver.snapshot', { sinceSeq, sessionId }, { signal, timeoutMs: 20000 })
}

export function fetchStatus(sessionId: string, signal?: AbortSignal): Promise<StatusResponse> {
  return postJson<StatusResponse>('/api/jumpserver.status', { sessionId }, { signal })
}

/** Explicit user action: close SSH and revoke this conversation grant. */
export function terminateJumpServer(sessionId: string, signal?: AbortSignal): Promise<StatusResponse> {
  return postJson<StatusResponse>('/api/jumpserver.close', { sessionId }, { signal, acceptErrorBody: true })
}


/** Explicit HUMAN command from the sidebar; see Host bridge for safety rules.
 *  V0.2.7: confirmed=true acknowledges the CONFIRM_MODIFY gate for one call.
 *  V0.3.1: the confirmed call must present the one-time confirmToken issued by
 *  the first MANUAL_CONFIRM_REQUIRED response (host validates session + command
 *  hash + risk + single use). */
export function sendManualCommand(sessionId: string, command: string, signal?: AbortSignal, confirmed = false, confirmToken?: string): Promise<ManualCommandResponse> {
  return postJson<ManualCommandResponse>(
    '/api/jumpserver.manual',
    { sessionId, command, confirmed, confirmToken },
    { signal, timeoutMs: 605000, acceptErrorBody: true },
  )
}

/** V0.2.7: asset picker rows (menu state required on the host). */
export function fetchAssets(sessionId: string, opts: { filter?: string; group?: string; refresh?: boolean } = {}, signal?: AbortSignal): Promise<AssetsResponse> {
  return postJson<AssetsResponse>('/api/jumpserver.assets', { sessionId, ...opts }, { signal, acceptErrorBody: true })
}

/** V0.2.7: recent audited commands of this conversation. */
export function fetchAudit(sessionId: string, signal?: AbortSignal): Promise<AuditResponse> {
  return postJson<AuditResponse>('/api/jumpserver.audit', { sessionId }, { signal })
}

/** V0.2.7: test connection optionally against a DRAFT config (not the saved one).
 *  V0.3.1: the draft also carries passwordEnv — editing ONLY the credential ref
 *  (without retyping the password) must test against the NEW ref. */
export function fetchTestConnection(draft?: { host?: string; port?: number; username?: string; password?: string; passwordEnv?: string }): Promise<TestResponse> {
  return postJson<TestResponse>('/api/jumpserver.test', draft ?? {}, { timeoutMs: 30000 })
}

/** V0.3.1 #16: command risk checker — pure classification, never connects. */
export interface ClassifyResponse {
  ok?: boolean
  code?: string
  message?: string
  risk?: string
  reason?: string
  ruleId?: string
  confidence?: string
  classifierVersion?: number
  normalizedCommand?: string
}

export function fetchClassify(command: string, signal?: AbortSignal): Promise<ClassifyResponse> {
  return postJson<ClassifyResponse>('/api/jumpserver.classify', { command }, { signal, timeoutMs: 10000 })
}

/** V0.4.0: one streaming job of this conversation. */
export interface JobEntry {
  id: string
  target: string
  hostname: string | null
  command: string
  state: string
  startedAt: number
  stoppedAt: number | null
  bytes: number
  truncated: boolean
  error: string | null
}

/** V0.4.0: streaming jobs of this conversation (never another's). */
export interface JobsResponse {
  ok?: boolean
  code?: string
  message?: string
  count?: number
  jobs?: JobEntry[]
}

export interface JobStopResponse {
  ok?: boolean
  code?: string
  message?: string
  jobId?: string
  jobState?: string
  target?: string | null
  error?: string | null
}

/**
 * V0.4.5: the outcome of the ONE interrupt entry point. mode=job means a
 * streaming job owned the PTY and was stopped through the job path (exactly one
 * Ctrl+C); mode=shell means a bare shell got the out-of-band interrupt.
 */
export interface InterruptResponse {
  ok?: boolean
  code?: string
  message?: string
  mode?: string
  sent?: boolean
  verified?: boolean
  state?: string
  target?: string | null
  jobId?: string | null
  jobState?: string | null
  jobsStopped?: number
}

export function fetchJobs(sessionId: string, signal?: AbortSignal): Promise<JobsResponse> {
  return postJson<JobsResponse>('/api/jumpserver.jobs', { sessionId }, { signal, timeoutMs: 10000 })
}

export function stopJob(sessionId: string, jobId: string, signal?: AbortSignal): Promise<JobStopResponse> {
  return postJson<JobStopResponse>('/api/jumpserver.jobStop', { sessionId, jobId }, { signal, timeoutMs: 30000, acceptErrorBody: true })
}

export function interruptSession(sessionId: string, signal?: AbortSignal): Promise<InterruptResponse> {
  return postJson<InterruptResponse>('/api/jumpserver.interrupt', { sessionId }, { signal, timeoutMs: 30000, acceptErrorBody: true })
}
