import { DEFAULT_TIMEOUTS } from '../config/types.js';
import { JumpServerSession } from '../jumpserver/session.js';
import { toRuntimeConfig } from '../jumpserver/session-manager.js';
import { SessionState } from '../jumpserver/state-machine.js';
import { PROTOCOL_VERSION, PLUGIN_VERSION, hostBuild } from '../version.js';
import { manualPolicyOf } from '../config/types.js';
import { resolveTimeZone } from '../runtime/time.js';
import { serializeAudit } from '../runtime/audit-export.js';
import { classifyCommand } from '../security/permission.js';
const SNAPSHOT_HOLD_MS = 12000;
const MAX_MANUAL_COMMAND_CHARS = 8192;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
function json(res, status, body) {
    if (res.writableEnded || res.destroyed)
        return;
    try {
        res.writeHead(status, JSON_HEADERS);
        res.end(JSON.stringify(body));
    }
    catch {
        /* client already gone */
    }
}
async function readJsonBody(req, limit = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > limit)
            throw new Error('body too large');
        chunks.push(buf);
    }
    if (chunks.length === 0)
        return {};
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
    }
    catch {
        return {};
    }
}
function statusPayload(services, sessionId) {
    const st = services.statusFor(sessionId);
    const cfg = services.getConfig();
    const observer = services.observerFor(sessionId);
    return {
        state: st.state,
        connected: st.connected,
        configured: st.configured,
        enabled: cfg.enabled,
        gateway: st.gateway,
        target: st.target,
        hostname: st.hostname,
        user: st.user,
        permissionMode: st.permissionMode,
        // Effective display zone, so the console never has to guess one. Stored
        // audit timestamps stay UTC; this only affects presentation.
        timeZone: resolveTimeZone(cfg.timeZone),
        manualPolicy: manualPolicyOf(cfg),
        granted: services.grantedFor(sessionId),
        connectionSource: st.connectionSource,
        // V0.4.1: the page can open the console itself once the conversation is
        // granted — the Host cannot raise UI, so the browser half does it.
        consoleUrl: services.consoleUrlFor?.(sessionId),
        connectionComplete: Boolean(cfg.host && cfg.username),
        connectionMissing: cfg.host ? (cfg.username ? [] : ['username']) : (cfg.username ? ['host'] : ['host', 'username']),
        lastSeq: observer?.cursorSeq ?? 0,
        pluginVersion: PLUGIN_VERSION,
        hostBuild: hostBuild(),
        protocolVersion: PROTOCOL_VERSION,
    };
}
/**
 * Browser mutation routes are same-site only. Modern browsers send
 * Sec-Fetch-Site; rejecting `cross-site` blocks CSRF without making reverse
 * proxy Host/Origin assumptions. Non-browser/tests that omit the header remain
 * supported. Every bridge endpoint is POST-only as a second boundary.
 */
function requirePost(req, res) {
    if (req.method !== 'POST') {
        json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST required' });
        return false;
    }
    const fetchSite = req.headers?.['sec-fetch-site'];
    const site = Array.isArray(fetchSite) ? fetchSite[0] : fetchSite;
    if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
        json(res, 403, { ok: false, code: 'CROSS_SITE_BLOCKED', message: 'cross-site browser request rejected' });
        return false;
    }
    return true;
}
function validSessionId(value) {
    if (typeof value !== 'string')
        return null;
    const sessionId = value.trim();
    return sessionId.length > 0 && sessionId.length <= 512 ? sessionId : null;
}
function requireGrant(services, sessionId, res) {
    if (services.grantedFor(sessionId))
        return true;
    json(res, 403, {
        ok: false,
        code: 'JUMPSERVER_NOT_ARMED',
        message: 'JumpServer is locked for this conversation; authorize it again before sending commands or reading protected session data.',
        granted: false,
        sessionId,
    });
    return false;
}
export function registerBridgeRoutes(webServer, services) {
    const disposers = [];
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.status',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined;
                json(res, 200, { ok: true, sessionId: sessionId ?? null, ...statusPayload(services, sessionId) });
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.snapshot',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sinceSeq = typeof body.sinceSeq === 'number' && Number.isFinite(body.sinceSeq) ? body.sinceSeq : 0;
                    const sessionId = validSessionId(body.sessionId);
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                        return;
                    }
                    // Terminal output can contain internal hostnames, paths and command
                    // results. A guessed/stale sessionId must never be enough to read it.
                    if (!requireGrant(services, sessionId, res))
                        return;
                    const observer = services.observerFor(sessionId);
                    if (observer !== null) {
                        // Event-driven: the observer wakes this exact request the moment a
                        // PTY event lands. The previous 150ms cursor poll woke the timer even
                        // for a console that was simply idle.
                        await observer.waitForChange(sinceSeq, requestAbort(req, res), SNAPSHOT_HOLD_MS);
                    }
                    const events = observer !== null
                        ? observer.snapshotSince(sinceSeq).filter((event) => !('visibility' in event) || event.visibility !== 'internal')
                        : [];
                    json(res, 200, {
                        ok: true,
                        lastSeq: observer?.cursorSeq ?? 0,
                        oldestSeq: observer?.oldestSeq ?? 0,
                        events,
                        sessionId,
                        ...statusPayload(services, sessionId),
                    });
                }
                catch (error) {
                    json(res, 400, { ok: false, code: 'BRIDGE_ERROR', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.close',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const sessionId = validSessionId(body.sessionId);
                if (sessionId === null) {
                    json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                    return;
                }
                // Close deliberately remains available even after a grant is revoked:
                // a locked conversation must always be able to tear down stale SSH.
                if (services.terminateFor === undefined)
                    throw new Error('termination service unavailable');
                await services.terminateFor(sessionId);
                json(res, 200, { ok: true, state: SessionState.DISCONNECTED, connected: false, granted: false, sessionId });
            })().catch((error) => json(res, 500, { ok: false, code: 'CLOSE_FAILED', message: error instanceof Error ? error.message : String(error) }));
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.manual',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    const command = typeof body.command === 'string' ? body.command : '';
                    const confirmed = body.confirmed === true;
                    const confirmToken = typeof body.confirmToken === 'string' && body.confirmToken.length > 0 ? body.confirmToken : undefined;
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                        return;
                    }
                    // P0: a live PTY alone is not authorization. Once the turn/persistent
                    // grant is revoked, the browser cannot keep driving that SSH session.
                    if (!requireGrant(services, sessionId, res))
                        return;
                    if (command.trim().length === 0 || command.length > MAX_MANUAL_COMMAND_CHARS || /[\r\n\x00]/.test(command)) {
                        json(res, 400, {
                            ok: false,
                            code: 'INVALID_COMMAND',
                            message: 'manual command must be one non-empty line of at most ' + MAX_MANUAL_COMMAND_CHARS + ' characters',
                        });
                        return;
                    }
                    const controller = new AbortController();
                    const onAborted = () => controller.abort();
                    req.once('aborted', onAborted);
                    try {
                        const result = await services.manualExec(sessionId, command, controller.signal, confirmed, confirmToken);
                        json(res, result.ok === false ? 409 : 200, result);
                    }
                    finally {
                        req.off('aborted', onAborted);
                    }
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'MANUAL_EXEC_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.diag',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const event = typeof body.event === 'string' ? body.event.slice(0, 120) : '';
                if (event.length > 0 && services.diagFor !== undefined) {
                    const detail = body.detail !== null && typeof body.detail === 'object' && !Array.isArray(body.detail)
                        ? body.detail
                        : undefined;
                    try {
                        services.diagFor(event, detail);
                    }
                    catch { /* telemetry must never break the page */ }
                }
                json(res, 200, { ok: true });
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.jobs',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                        return;
                    }
                    if (!requireGrant(services, sessionId, res))
                        return;
                    const jobs = services.jobsFor !== undefined ? await services.jobsFor(sessionId) : [];
                    json(res, 200, { ok: true, jobs, count: jobs.length, sessionId });
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'JOBS_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.jobStop',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
                    if (sessionId === null || jobId.length === 0) {
                        json(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'valid sessionId and jobId are required' });
                        return;
                    }
                    if (!requireGrant(services, sessionId, res))
                        return;
                    if (services.jobStopFor === undefined) {
                        json(res, 501, { ok: false, code: 'NOT_SUPPORTED', message: 'job control is unavailable' });
                        return;
                    }
                    const result = await services.jobStopFor(sessionId, jobId);
                    json(res, result.ok === false ? 409 : 200, result);
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'JOB_STOP_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.interrupt',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                        return;
                    }
                    if (!requireGrant(services, sessionId, res))
                        return;
                    if (services.interruptFor === undefined) {
                        json(res, 501, { ok: false, code: 'NOT_SUPPORTED', message: 'interrupt is unavailable' });
                        return;
                    }
                    const result = await services.interruptFor(sessionId);
                    json(res, 200, result);
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'INTERRUPT_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.auditExport',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    const format = body.format === 'json' ? 'json' : body.format === 'markdown' ? 'markdown' : 'csv';
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'valid sessionId is required' });
                        return;
                    }
                    if (!requireGrant(services, sessionId, res))
                        return;
                    // Serialised by the SAME tested module the settings surface uses, so
                    // the console export cannot drift away from it.
                    const records = services.auditFor(sessionId);
                    json(res, 200, { ok: true, format, content: serializeAudit(records, format), count: records.length });
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'AUDIT_EXPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.consoleAlive',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_REQUEST', message: 'valid sessionId is required' });
                        return;
                    }
                    if (body.heartbeat === true)
                        services.noteConsoleAlive?.(sessionId);
                    json(res, 200, { ok: true, active: services.consoleActiveFor?.(sessionId) === true });
                }
                catch (error) {
                    json(res, 500, { ok: false, code: 'CONSOLE_ALIVE_FAILED', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.classify',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const command = typeof body.command === 'string' ? body.command : '';
                if (command.trim().length === 0 || command.length > MAX_MANUAL_COMMAND_CHARS) {
                    json(res, 400, { ok: false, code: 'INVALID_COMMAND', message: 'command must be one non-empty line' });
                    return;
                }
                const c = classifyCommand(command);
                json(res, 200, {
                    ok: true,
                    risk: c.risk,
                    reason: c.reason,
                    ruleId: c.ruleId,
                    confidence: c.confidence,
                    classifierVersion: c.classifierVersion,
                    normalizedCommand: c.normalizedCommand,
                });
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.test',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const result = await runConnectionTest(services, body);
                json(res, 200, result);
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.assets',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                try {
                    const body = await readJsonBody(req);
                    const sessionId = validSessionId(body.sessionId);
                    if (sessionId === null) {
                        json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                        return;
                    }
                    // Asset discovery exposes internal host inventory and actively sends
                    // KoKo's `p`; it follows the same conversation grant boundary.
                    if (!requireGrant(services, sessionId, res))
                        return;
                    const observer = services.observerFor(sessionId);
                    if (observer === null) {
                        json(res, 409, { ok: false, code: 'NO_SESSION', message: 'no JumpServer session for this conversation' });
                        return;
                    }
                    // The structured asset picker consumes the same PTY bytes, but the
                    // raw 100+ row KoKo table is implementation detail and should not
                    // flood the human terminal. Keep it in the Host observer only while
                    // this structured request runs; /snapshot filters internal events.
                    const endInternalCapture = observer.beginInternalCapture();
                    let bundle;
                    try {
                        bundle = await services.assetList(sessionId, {
                            filter: typeof body.filter === 'string' ? body.filter : undefined,
                            group: typeof body.group === 'string' ? body.group : undefined,
                            refresh: body.refresh === true,
                        });
                    }
                    finally {
                        endInternalCapture();
                    }
                    if (bundle === null) {
                        json(res, 409, { ok: false, code: 'NOT_AT_MENU', message: 'assets are available at the JumpServer menu; connect or return to the bastion menu first' });
                        return;
                    }
                    json(res, 200, {
                        ok: true,
                        count: bundle.count,
                        reportedTotal: bundle.reportedTotal,
                        complete: bundle.complete,
                        health: bundle.health,
                        filter: bundle.filter,
                        group: bundle.group,
                        groupMatched: bundle.groupMatched,
                        groups: services.assetGroupNames(),
                        rows: bundle.assets,
                        sessionId,
                    });
                }
                catch (error) {
                    json(res, 400, { ok: false, code: 'BRIDGE_ERROR', message: error instanceof Error ? error.message : String(error) });
                }
            })();
        },
    }));
    disposers.push(webServer.register({
        kind: 'exact',
        path: '/api/jumpserver.audit',
        handler: (req, res) => {
            if (!requirePost(req, res))
                return;
            void (async () => {
                const body = await readJsonBody(req);
                const sessionId = validSessionId(body.sessionId);
                if (sessionId === null) {
                    json(res, 400, { ok: false, code: 'INVALID_SESSION', message: 'valid sessionId is required' });
                    return;
                }
                // Audit rows disclose command history, internal hosts and decisions;
                // protect them with the same per-conversation grant as terminal data.
                if (!requireGrant(services, sessionId, res))
                    return;
                json(res, 200, { ok: true, records: services.auditFor(sessionId), sessionId });
            })();
        },
    }));
    return () => {
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch {
                /* already disposed */
            }
        }
    };
}
/**
 * Abort as soon as the client goes away.
 *
 * Without this a closed console tab leaves the request parked for the whole
 * long-poll window, holding a waiter that no longer has a consumer.
 */
function requestAbort(req, res) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    req.once('aborted', stop);
    res.once('close', stop);
    return controller.signal;
}
export function draftPasswordSource(draft, cfg) {
    if (typeof draft.password === 'string' && draft.password.length > 0)
        return { env: null };
    const env = typeof draft.passwordEnv === 'string' && draft.passwordEnv.trim().length > 0 ? draft.passwordEnv.trim() : cfg.passwordEnv;
    return { env };
}
export async function runConnectionTest(services, draft = {}) {
    const cfg = services.getConfig();
    const draftHost = typeof draft.host === 'string' && draft.host.trim().length > 0 ? draft.host.trim() : undefined;
    const draftPort = typeof draft.port === 'number' && Number.isFinite(draft.port) ? Math.trunc(draft.port) : undefined;
    const draftUser = typeof draft.username === 'string' && draft.username.trim().length > 0 ? draft.username.trim() : undefined;
    const host = draftHost ?? cfg.host;
    const port = draftPort ?? cfg.port;
    const username = draftUser ?? cfg.username;
    const enabled = cfg.enabled;
    if (enabled === false)
        return { ok: false, code: 'DISABLED', message: 'JumpServer is disabled in settings' };
    if (!host || !username || port < 1) {
        return { ok: false, code: 'NOT_CONFIGURED', message: 'JumpServer host/username are not configured' };
    }
    const identityChanged = (draftHost !== undefined && draftHost !== cfg.host) ||
        (draftPort !== undefined && draftPort !== cfg.port) ||
        (draftUser !== undefined && draftUser !== cfg.username);
    const hasLiteralPassword = typeof draft.password === 'string' && draft.password.length > 0;
    const draftUsed = draftHost !== undefined || draftPort !== undefined || draftUser !== undefined ||
        draft.password !== undefined || draft.passwordEnv !== undefined;
    if (identityChanged && !hasLiteralPassword) {
        return {
            ok: false,
            code: 'CREDENTIAL_MISMATCH',
            message: 'draft host/port/username differs from the saved gateway; the saved JumpServer password is never used against a different target — provide a temporary password for this test',
            gateway: host + ':' + port,
            user: username,
            draft: true,
        };
    }
    const source = draftPasswordSource(draft, cfg);
    let password;
    if (source.env === null) {
        password = String(draft.password);
    }
    else {
        password = await services.resolvePassword(source.env);
    }
    if (password === undefined || password.length === 0) {
        return { ok: false, code: 'NOT_CONFIGURED', message: 'JumpServer password is not configured (set ' + source.env + ' or the password setting)', draft: draftUsed, gateway: host + ':' + port, user: username };
    }
    const runtime = {
        ...toRuntimeConfig({ ...cfg, host, port, username }, password, undefined),
        connectTimeoutMs: Math.min(cfg.connectTimeout * 1000, DEFAULT_TIMEOUTS.connect * 2),
    };
    const session = new JumpServerSession(runtime, {});
    const started = Date.now();
    const gateway = host + ':' + port;
    try {
        await session.connect();
        const state = session.state;
        const latencyMs = Date.now() - started;
        await session.close();
        return {
            ok: state === SessionState.JUMPSERVER_MENU || state === SessionState.ASSET_SHELL,
            message: 'JumpServer 连接成功（菜单识别完成）',
            gateway,
            user: username,
            latencyMs,
            state,
            draft: draft.host !== undefined || draft.port !== undefined || draft.username !== undefined
                || draft.password !== undefined || draft.passwordEnv !== undefined,
        };
    }
    catch (error) {
        const code = error instanceof Error && error.code !== undefined ? String(error.code) : 'FAILED';
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, code, message, latencyMs: Date.now() - started, gateway, user: username, draft: true };
    }
    finally {
        try {
            await session.close();
        }
        catch {
            /* already closed */
        }
    }
}
