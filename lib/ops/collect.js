import { JumpServerError } from '../jumpserver/errors.js';
import { classifyCommand } from '../security/command-classifier.js';
import { DETECT_PROFILE, detectAppIds, linuxCommands, profileCommands, resolveProfile, sanitizeSince } from './profiles.js';
/**
 * V0.3.1 P0: one trusted-read entry. The classifier — not the profile author —
 * decides the risk; anything the classifier does not confirm as READ aborts
 * with PROFILE_RISK_MISMATCH instead of executing.
 */
export function trustedRead(command) {
    const c = classifyCommand(command);
    if (c.risk !== 'READ') {
        throw new JumpServerError('PROFILE_RISK_MISMATCH', 'profile command is not a confirmed READ: ' + command + ' (classified ' + c.risk + ' / ' + c.ruleId + '); sweep aborted');
    }
    return {
        command,
        risk: c.risk,
        actor: 'SYSTEM_PROFILE',
        classification: { risk: c.risk, reason: c.reason, ruleId: c.ruleId, confidence: c.confidence, classifierVersion: c.classifierVersion, normalizedCommand: c.normalizedCommand },
    };
}
function collectedOf(batch, plan) {
    return plan.map((p, i) => {
        const r = batch.commands[i];
        if (r === undefined)
            return { command: p.command, category: p.category, label: p.label ?? null, exitCode: null, output: '', truncated: false, error: { code: 'COLLECT_MISSING', message: 'command result missing' } };
        return {
            command: p.command,
            category: p.category,
            label: p.label ?? null,
            exitCode: r.exitCode,
            output: r.output,
            truncated: r.truncated,
            error: r.error,
        };
    });
}
/** Phase-A: base sweep + detection commands (always run first). */
function phaseOne(profileId, since) {
    const base = linuxCommands(since);
    if (profileId !== undefined && profileId !== 'auto' && profileId !== '') {
        // explicit named profile: base + named profile (detection still cheap, skip phase-2 jumping)
        const p = resolveProfile(profileId);
        if (p === undefined)
            throw new Error('UNKNOWN_PROFILE: ' + profileId);
        return { commands: base, names: p.commands };
    }
    return { commands: [...base, ...DETECT_PROFILE.commands], names: [] };
}
export async function runProfileSweep(manager, target, options = {}) {
    const profileId = (options.profile ?? 'auto').trim();
    const since = sanitizeSince(options.since);
    const phase1 = await manager.runTargetBatch({
        target,
        commands: phaseOne(profileId, since).commands.map((c) => trustedRead(c.command)),
        signal: options.signal,
    });
    if (phase1.error !== null) {
        return { commands: [], detected: [], profilesUsed: [], hostname: null, error: phase1.error };
    }
    const hostname = phase1.hostname;
    const first = collectedOf(phase1, phaseOne(profileId, since).commands);
    let profilesUsed = ['linux'];
    let detected = [];
    let extra = [];
    if (profileId === 'auto' || profileId === '') {
        const detectionText = first
            .filter((c) => c.category === 'detect')
            .map((c) => c.output)
            .join('\n');
        detected = detectAppIds(detectionText);
        profilesUsed = ['linux', ...detected];
        for (const id of detected) {
            const p = resolveProfile(id);
            if (p !== undefined)
                extra.push(...profileCommands(p, since));
        }
    }
    else {
        const p = resolveProfile(profileId);
        if (p !== undefined) {
            extra.push(...profileCommands(p, since));
            profilesUsed = ['linux', p.id];
        }
    }
    profilesUsed = [...new Set(profilesUsed)];
    let second = [];
    if (extra.length > 0) {
        const phase2 = await manager.runTargetBatch({
            target,
            commands: extra.map((c) => trustedRead(c.command)),
            signal: options.signal,
        });
        if (phase2.error === null)
            second = collectedOf(phase2, extra);
        // navigation error on phase 2: keep phase-1 evidence, note the gap
    }
    return { commands: [...first, ...second], detected, profilesUsed, hostname, error: null };
}
// ---------- light parsers + findings ----------
export function parseUptime(text) {
    const m = /load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(text);
    if (m === null)
        return { load1: null, load5: null, load15: null };
    return { load1: Number(m[1]), load5: Number(m[2]), load15: Number(m[3]) };
}
export function parseFreeMem(text) {
    const m = /^Mem:\s*([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)/m.exec(text);
    if (m === null)
        return { totalMb: null, usedPct: null };
    const total = Number(m[1]);
    const used = Number(m[2]);
    const avail = Number(m[6]);
    return { totalMb: total, usedPct: Math.round(((total - avail) / total) * 100) };
}
export function parseDfRoot(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6 && parts[parts.length - 1] === '/') {
            const use = parts[parts.length - 2] ?? '';
            const pct = /(\d+)%/.exec(use);
            if (pct !== null)
                return Number(pct[1]);
        }
    }
    return null;
}
/** Derive red-flag findings from collected commands (root-cause hypotheses seed). */
export function deriveFindings(commands) {
    const findings = [];
    for (const c of commands) {
        const out = c.output.trim();
        if (c.category === 'process' && c.command.includes('zombie_count')) {
            const m = /zombie_count=(\d+)/.exec(out);
            const n = m !== null ? Number(m[1]) : 0;
            if (n > 0)
                findings.push('zombie processes: ' + n);
            continue;
        }
        if (c.command.startsWith('free -m')) {
            const mem = parseFreeMem(out);
            if (mem.usedPct !== null && mem.usedPct >= 90)
                findings.push('memory usage ' + mem.usedPct + '% (>=90%)');
            continue;
        }
        if (c.command.startsWith('df -h')) {
            const diskRoot = parseDfRoot(out);
            if (diskRoot !== null && diskRoot >= 85)
                findings.push('root disk usage ' + diskRoot + '% (>=85%)');
            continue;
        }
        if (c.category === 'errors' && out.length > 0 && c.exitCode === 0) {
            findings.push('error-window output present: ' + c.command.slice(0, 60));
            continue;
        }
        if (c.category === 'service' && /failed/i.test(out)) {
            findings.push('service check shows failed units: ' + c.command.slice(0, 60));
            continue;
        }
        if (c.command.includes('nginx -t') && /fail|error/i.test(out)) {
            findings.push('nginx -t reports a config problem');
            continue;
        }
    }
    return [...new Set(findings)];
}
