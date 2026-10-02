/**
 * Streaming-job toolkit (V0.4.0 / V0.4.5, ported from jumpserver-mcp v0.5.13).
 *
 * A streaming command (tail -f, journalctl -f, tcpdump, top -b) never returns
 * on its own, so it does not fit the "run until the completion marker" model.
 * It is started as a JOB: the job owns the PTY until it is stopped, output is
 * harvested from the conversation's TerminalObserver, and the model reads it
 * with a cursor (`nextSeq` -> `sinceSeq`) instead of re-reading the tail.
 *
 * V0.4.5 rules that these tools must keep:
 *  - exactly ONE Ctrl+C per interrupt: a session with a streaming job has one
 *    owner (the JobStore), so interruptSession() delegates instead of sending
 *    a second signal (see runtime/interrupt.ts);
 *  - jobs are conversation-scoped: list/read/stop can never see another
 *    conversation's job;
 *  - job_start goes through the SAME permission gate as every other execution
 *    tool, and forwards the deferred gate so the manager derives the real
 *    approval outcome.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { JUMPSERVER_NOT_ARMED, NOT_ARMED_MESSAGE } from '../security/grant.js';
import { gateCommandForNavigation } from '../security/permission-gate.js';
import { requireTargetAllowed } from '../security/target-scope.js';
import { interruptSession } from '../runtime/interrupt.js';
import { bundleFor, guardValue, renderResult, RESULT_SCHEMA, sessionIdOf } from './common.js';
/** Result schema for the job/snapshot tools (RESULT_SCHEMA + job fields). */
const JOB_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ...RESULT_SCHEMA.properties,
        jobId: { type: 'string' },
        jobState: { type: 'string' },
        riskJudge: { type: 'string' },
        consoleUrl: { type: 'string' },
        jobsStopped: { type: 'integer' },
        interrupted: { type: 'boolean' },
        verified: { type: 'boolean' },
        mode: { type: 'string' },
        nextSeq: { type: 'integer' },
        droppedChars: { type: 'integer' },
        partial: { type: 'boolean' },
        full: { type: 'boolean' },
        lastSeq: { type: 'integer' },
        oldestSeq: { type: 'integer' },
        eventCount: { type: 'integer' },
        maxDurationMs: { type: 'integer' },
        jobs: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string' },
                    target: { type: 'string' },
                    hostname: { type: 'string' },
                    command: { type: 'string' },
                    state: { type: 'string' },
                    startedAt: { type: 'integer' },
                    stoppedAt: { type: 'integer' },
                    durationMs: { type: 'integer' },
                    bytes: { type: 'integer' },
                    truncated: { type: 'boolean' },
                    error: { type: 'string' },
                },
            },
        },
    },
};
function notArmed() {
    return { ok: false, code: JUMPSERVER_NOT_ARMED, message: NOT_ARMED_MESSAGE };
}
function requireGrant(grants, exec) {
    return grants.isGranted(sessionIdOf(exec)) ? null : notArmed();
}
function jobSummary(job) {
    return {
        id: job.id,
        target: job.target,
        ...(job.hostname !== null ? { hostname: job.hostname } : {}),
        command: job.command,
        state: job.state,
        startedAt: job.startedAt,
        ...(job.stoppedAt !== null ? { stoppedAt: job.stoppedAt } : {}),
        durationMs: (job.stoppedAt ?? Date.now()) - job.startedAt,
        bytes: job.bytes,
        truncated: job.truncated,
        ...(job.error !== null ? { error: job.error } : {}),
    };
}
/** Render the terminal mirror as bounded text (internal/capture noise removed). */
function renderEvents(events) {
    const lines = [];
    for (const event of events) {
        const type = String(event.type ?? '');
        if (type === 'input')
            lines.push('$ ' + String(event.data ?? ''));
        else if (type === 'output')
            lines.push(String(event.data ?? ''));
        else if (type === 'state')
            lines.push('[state] ' + String(event.prev ?? '?') + ' -> ' + String(event.state ?? '?'));
        else if (type === 'target')
            lines.push('[target] ' + String(event.target ?? '') + (event.hostname ? ' (' + String(event.hostname) + ')' : ''));
        else if (type === 'error')
            lines.push('[error] ' + String(event.message ?? ''));
    }
    return lines.join('\n');
}
export function registerJobTools(ctx, registry, getConfig, grants, jobs) {
    const disposers = [];
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_interrupt',
        description: 'Send Ctrl+C to the remote shell NOW to interrupt whatever is running (a stuck command, a tail that will not end, a long find). Out-of-band: it does NOT wait for the current operation to finish. Afterwards the connector re-probes the shell and reports whether it is usable again (ASSET_SHELL) or collapsed to UNKNOWN. When a streaming job owns the shell, this stops that job through the job path instead, so exactly ONE Ctrl+C is sent. Use it instead of jumpserver_close when you only want to stop the remote work and keep the session.',
        parameters: {},
        output: { schema: JOB_SCHEMA, render: renderResult },
        timeoutMs: 60000,
        async execute(_args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                const bundle = bundleFor(exec, registry);
                const sessionId = sessionIdOf(exec);
                const result = await interruptSession(jobs, bundle.manager, sessionId);
                return {
                    ok: result.sent,
                    ...(result.sent ? {} : { code: 'NOTHING_TO_INTERRUPT' }),
                    message: result.message,
                    state: result.state,
                    ...(result.target !== null ? { target: result.target } : {}),
                    interrupted: result.sent,
                    verified: result.verified,
                    mode: result.mode,
                    ...(result.jobId !== null ? { jobId: result.jobId } : {}),
                    ...(result.jobState !== null ? { jobState: result.jobState } : {}),
                    jobsStopped: result.jobsStopped,
                };
            });
        },
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_job_start',
        description: 'Start a STREAMING job on a server — for commands that never return on their own: "tail -f /var/log/app.log", "journalctl -f -u nginx", "tcpdump -i any port 8080", "top -b", ping. Returns a jobId; then poll jumpserver_job_read(jobId) for the NEW output and call jumpserver_job_stop(jobId) when done. While the job runs the shell is reserved for it (other commands on this conversation fail with SESSION_BUSY) and it auto-stops at maxDuration. Subject to the configured permission mode exactly like jumpserver_run.',
        parameters: {
            target: { type: 'string', required: true, description: 'Target asset IP or name, e.g. 203.0.113.101' },
            command: { type: 'string', required: true, description: 'Streaming command, e.g. "tail -f /var/log/app.log"' },
            maxDuration: { type: 'number', description: 'Auto-stop after N seconds (default 300, max 900)' },
            accountIndex: { type: 'number', description: 'V0.5.3: the account ID KoKo shows at its ID> prompt for multi-user assets.' },
        },
        output: { schema: JOB_SCHEMA, render: renderResult },
        timeoutMs: 605000,
        async execute(args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                requireTargetAllowed(getConfig(), args.target);
                const bundle = bundleFor(exec, registry);
                const services = { getConfig, manager: bundle.manager, approval: ctx.get('approval') };
                // V0.4.3: job_start shares the SAME gate as every other execution
                // tool, so READ_ONLY cannot be bypassed and the audit gets the real
                // classification instead of a hardcoded READ.
                const gated = await gateCommandForNavigation(services, exec, args.command);
                const job = await jobs.start({
                    sessionId: sessionIdOf(exec),
                    target: args.target,
                    command: args.command,
                    maxDurationMs: args.maxDuration !== undefined ? Math.max(1, args.maxDuration) * 1000 : undefined,
                    signal: exec.signal,
                    toolCallId: String(exec.callId),
                    accountIndex: typeof args.accountIndex === 'number' ? args.accountIndex : undefined,
                    classification: {
                        risk: gated.classification.risk,
                        reason: gated.classification.reason,
                        ruleId: gated.classification.ruleId,
                        confidence: gated.classification.confidence,
                        classifierVersion: gated.classification.classifierVersion,
                        normalizedCommand: gated.classification.normalizedCommand,
                    },
                    approvalRequired: gated.approvalRequired,
                    // V0.5.8: the audit must show not just what ran but who let it
                    // run unattended.
                    riskJudge: gated.judgeNote,
                    beforeExec: gated.beforeExec,
                });
                return {
                    ok: true,
                    jobId: job.id,
                    target: job.target,
                    ...(job.hostname !== null ? { hostname: job.hostname } : {}),
                    jobState: job.state,
                    maxDurationMs: job.maxDurationMs,
                    ...(gated.judgeNote !== undefined ? { riskJudge: gated.judgeNote } : {}),
                    message: 'job started: 用 jumpserver_job_read(jobId="' + job.id + '") 读取增量输出，jumpserver_job_stop(jobId="' + job.id + '") 结束。',
                };
            });
        },
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_job_read',
        description: 'Read the output of a streaming job (jumpserver_job_start) as a CURSOR READ: by default it returns only what arrived after the previous read, plus nextSeq — pass that back as sinceSeq so you resume exactly where you left off (safe to retry, never re-consumes old lines). full:true returns the whole buffered output instead.',
        parameters: {
            jobId: { type: 'string', required: true, description: 'Job id returned by jumpserver_job_start, e.g. jsjob_8fd11a' },
            sinceSeq: { type: 'number', description: 'Absolute cursor to resume from — pass the nextSeq of the previous read. Omit to continue from the last read.' },
            full: { type: 'boolean', description: 'Return the whole buffered output instead of only what arrived since the cursor (default false).' },
            maxChars: { type: 'number', description: 'Cap the returned characters (default 8000, max 200000).' },
        },
        output: { schema: JOB_SCHEMA, render: renderResult },
        async execute(args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                const view = jobs.read(args.jobId, {
                    sessionId: sessionIdOf(exec),
                    maxChars: typeof args.maxChars === 'number' ? args.maxChars : 8000,
                    full: args.full === true,
                    sinceSeq: typeof args.sinceSeq === 'number' ? args.sinceSeq : null,
                });
                if (view === null) {
                    return { ok: false, code: 'UNKNOWN_JOB', message: 'no job with id ' + args.jobId + ' in this conversation' };
                }
                return {
                    ok: view.state === 'RUNNING',
                    jobId: view.id,
                    jobState: view.state,
                    target: view.target,
                    ...(view.hostname !== null ? { hostname: view.hostname } : {}),
                    nextSeq: view.nextSeq,
                    droppedChars: view.droppedChars,
                    partial: view.partial,
                    full: view.mode === 'full',
                    ...(view.error !== null ? { message: view.error } : {}),
                    output: view.output,
                };
            });
        },
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_job_stop',
        description: 'Stop a streaming job started with jumpserver_job_start: sends exactly ONE Ctrl+C through the job path, re-probes the shell and releases it. Idempotent and safe to call twice — a second call shares the first verdict instead of interrupting the job again.',
        parameters: {
            jobId: { type: 'string', required: true, description: 'Job id returned by jumpserver_job_start' },
        },
        output: { schema: JOB_SCHEMA, render: renderResult },
        timeoutMs: 60000,
        async execute(args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                const sessionId = sessionIdOf(exec);
                const existing = jobs.get(args.jobId, sessionId);
                if (existing === null) {
                    return { ok: false, code: 'UNKNOWN_JOB', message: 'no job with id ' + args.jobId + ' in this conversation' };
                }
                const job = await jobs.stop(args.jobId, 'jumpserver_job_stop', sessionId);
                return {
                    ok: job.state === 'STOPPED',
                    jobId: job.id,
                    jobState: job.state,
                    target: job.target,
                    verified: job.state === 'STOPPED',
                    state: bundleFor(exec, registry).manager.status().state,
                    ...(job.error !== null ? { message: job.error } : {}),
                };
            });
        },
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_jobs',
        description: 'List the streaming jobs of YOUR conversation with their state, target and buffered byte count. A job of another conversation is never visible here.',
        parameters: {},
        output: { schema: JOB_SCHEMA, render: renderResult },
        async execute(_args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                const list = jobs.list(sessionIdOf(exec));
                return {
                    ok: true,
                    jobs: list.map(jobSummary),
                    count: list.length,
                    message: list.length === 0 ? 'no streaming job in this conversation' : list.length + ' job(s)',
                };
            });
        },
    })));
    disposers.push(ctx.tools.register(defineTool({
        name: 'jumpserver_snapshot',
        description: 'Read the recent terminal mirror of YOUR conversation: the PTY input/output/state/target events the sidebar shows, with connector-internal capture traffic removed. Pass sinceSeq (from a previous lastSeq) to read only what is new. Use it to see what the remote shell actually printed without running another command.',
        parameters: {
            sinceSeq: { type: 'number', description: 'Only return events with seq greater than this (use the lastSeq of a previous snapshot).' },
            maxLines: { type: 'number', description: 'Cap the rendered lines (default 200).' },
        },
        output: { schema: JOB_SCHEMA, render: renderResult },
        async execute(args, exec) {
            return guardValue(exec, async () => {
                const blocked = requireGrant(grants, exec);
                if (blocked !== null)
                    return blocked;
                const bundle = bundleFor(exec, registry);
                const sinceSeq = typeof args.sinceSeq === 'number' && Number.isFinite(args.sinceSeq) ? args.sinceSeq : 0;
                const maxLines = typeof args.maxLines === 'number' && args.maxLines > 0 ? Math.min(2000, Math.floor(args.maxLines)) : 200;
                const events = bundle.observer.snapshotSince(sinceSeq)
                    .filter((event) => event['visibility'] !== 'internal');
                const rendered = renderEvents(events).split('\n');
                const window = rendered.length > maxLines ? rendered.slice(rendered.length - maxLines) : rendered;
                return {
                    ok: true,
                    sinceSeq,
                    lastSeq: bundle.observer.cursorSeq,
                    oldestSeq: bundle.observer.oldestSeq,
                    eventCount: events.length,
                    truncated: rendered.length > maxLines,
                    state: bundle.manager.status().state,
                    output: window.join('\n'),
                };
            });
        },
    })));
    return disposers;
}
