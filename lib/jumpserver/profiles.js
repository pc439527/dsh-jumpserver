/**
 * Inspect profiles (V0.4.0): FIXED, reviewed, read-only probe sets.
 *
 * The model must not invent shell for a survey — it picks a profile and the
 * connector runs exactly these commands. Every command is verified READ by
 * tests/security/command-classifier.test.mjs + the profile-safety test, so a
 * survey is safe even in READ_ONLY mode (probes that regress to a non-READ
 * classification are skipped, never silently executed).
 */
export const INSPECT_PROFILES = [
    'basic',
    'network',
    'process',
    'service',
    'web',
    'java',
    'database',
    'container',
    'full',
];
const BASIC = [
    { id: 'hostname', command: 'hostname' },
    { id: 'os-release', command: 'cat /etc/os-release' },
    { id: 'kernel', command: 'uname -r' },
    { id: 'uptime', command: 'uptime' },
    { id: 'loadavg', command: 'cat /proc/loadavg' },
    { id: 'nproc', command: 'nproc' },
    { id: 'memory', command: 'free -m' },
    { id: 'disk', command: 'df -h' },
    { id: 'addr', command: 'ip -o addr' },
    { id: 'route', command: 'ip route' },
];
const NETWORK = [
    { id: 'listen', command: 'ss -lntp' },
    { id: 'conns', command: 'ss -tnp' },
    { id: 'neigh', command: 'ip neigh' },
    { id: 'hosts', command: 'cat /etc/hosts' },
    { id: 'resolv', command: 'cat /etc/resolv.conf' },
];
const PROCESS = [
    { id: 'ps', command: 'ps -eo pid,ppid,user,%cpu,%mem,etime,args' },
];
const SERVICE = [
    { id: 'services', command: 'systemctl --type=service --state=running' },
];
const WEB = [
    { id: 'ps', command: 'ps -eo pid,ppid,user,%cpu,%mem,etime,args' },
    { id: 'nginx-conf', command: 'nginx -T' },
];
const JAVA = [
    { id: 'ps', command: 'ps -eo pid,ppid,user,%cpu,%mem,etime,args' },
    { id: 'jps', command: 'jps -lv' },
];
const DATABASE = [
    { id: 'ps', command: 'ps -eo pid,ppid,user,%cpu,%mem,etime,args' },
    { id: 'listen', command: 'ss -lntp' },
];
const CONTAINER = [
    { id: 'docker-ps', command: 'docker ps' },
    { id: 'ps', command: 'ps -eo pid,ppid,user,%cpu,%mem,etime,args' },
];
export const PROFILE_STEPS = {
    basic: BASIC,
    network: NETWORK,
    process: PROCESS,
    service: SERVICE,
    web: WEB,
    java: JAVA,
    database: DATABASE,
    container: CONTAINER,
};
export const DEFAULT_PROFILE = 'basic';
export function isInspectProfile(value) {
    return INSPECT_PROFILES.includes(value);
}
/** Merge profiles, de-duplicating by probe id (first occurrence wins). */
export function resolveProfile(names) {
    const raw = (Array.isArray(names) ? names : [names ?? DEFAULT_PROFILE]).map((n) => String(n).trim().toLowerCase());
    const list = raw.length > 0 ? raw : [DEFAULT_PROFILE];
    const expanded = list.includes('full')
        ? ['basic', 'network', 'process', 'service', 'web', 'java', 'database', 'container']
        : list;
    const used = [];
    const unknown = [];
    const steps = [];
    const seen = new Set();
    for (const name of expanded) {
        if (!isInspectProfile(name)) {
            unknown.push(name);
            continue;
        }
        if (name === 'full')
            continue;
        used.push(name);
        for (const step of PROFILE_STEPS[name]) {
            const key = step.id + '\u0000' + step.command;
            if (seen.has(key))
                continue;
            seen.add(key);
            steps.push(step);
        }
    }
    if (steps.length === 0) {
        for (const step of BASIC)
            steps.push(step);
        used.push('basic');
    }
    return { steps, used, unknown };
}
