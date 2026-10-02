/**
 * Host inventory parsing (V0.4.0): turn the raw text of the fixed probes into
 * one structured HostInventory per target.
 *
 * Every parser is defensive: a format it does not understand yields an empty
 * result (plus a warning when the probe actually ran), never a wrong value.
 * Facts the parser could not establish stay null — "unknown" must never be
 * presented as if it had been measured.
 */
export interface ListenEntry {
    proto: string;
    address: string;
    port: number;
    process: string | null;
}
export interface ConnectionEntry {
    remoteIp: string;
    remotePort: number | null;
    state: string;
    process: string | null;
}
export interface ProcessEntry {
    pid: number;
    ppid: number | null;
    user: string | null;
    cpu: number | null;
    mem: number | null;
    etime: string | null;
    cmd: string;
}
export interface InterfaceEntry {
    name: string;
    addrs: string[];
}
export interface DiskEntry {
    fs: string;
    size: string;
    used: string;
    avail: string;
    usePct: number | null;
    mount: string;
}
export interface NginxUpstream {
    name: string;
    servers: Array<{
        host: string;
        port: number | null;
    }>;
}
export interface JavaProcess {
    pid: number | null;
    main: string | null;
    args: string | null;
}
export interface ContainerEntry {
    id: string;
    image: string;
    name: string;
    status: string;
    ports: string;
}
export interface HostInventory {
    target: string;
    hostname: string | null;
    reachable: boolean;
    error: string | null;
    profiles: string[];
    os: {
        id: string | null;
        name: string | null;
        version: string | null;
    };
    kernel: string | null;
    uptime: string | null;
    load: number[] | null;
    cores: number | null;
    memory: {
        totalMb: number | null;
        usedMb: number | null;
        availableMb: number | null;
        usedPct: number | null;
    };
    disks: DiskEntry[];
    interfaces: InterfaceEntry[];
    defaultRoute: string | null;
    listening: ListenEntry[];
    connections: ConnectionEntry[];
    hosts: Array<{
        ip: string;
        names: string[];
    }>;
    processes: ProcessEntry[];
    services: string[];
    java: JavaProcess[];
    containers: ContainerEntry[];
    nginx: {
        upstreams: NginxUpstream[];
        proxies: string[];
        serverNames: string[];
    } | null;
    roles: string[];
    warnings: string[];
}
export declare function emptyInventory(target: string, profiles: string[], error?: string | null): HostInventory;
/**
 * Drop the shell's echo of the command from a probe's captured output.
 *
 * A PTY echoes what it receives, so a probe's text normally STARTS with the
 * command line, followed by a blank line, then the real output. Parsers that
 * read the first line or coerce the whole text then reported the COMMAND as the
 * value (hostname -> "hostname", nproc -> NaN). Parsers that SEARCH the whole
 * text survived, which is why only some inventory fields degraded.
 *
 * Only the leading echo is removed, and only when it matches the command that
 * was actually sent; anything else is left untouched.
 */
export declare function stripCommandEcho(output: string, command: string): string;
export declare function parseHostname(text: string, command?: string): string | null;
export declare function parseOsRelease(text: string): {
    id: string | null;
    name: string | null;
    version: string | null;
};
export declare function parseUptime(text: string): {
    uptime: string | null;
    load: number[] | null;
};
export declare function parseLoadavg(text: string): number[] | null;
export declare function parseMemory(text: string): HostInventory['memory'];
export declare function parseDisks(text: string): DiskEntry[];
/** `ip -o addr` -> one entry per interface with its non-loopback, non-link-local
 *  addresses. The interface row is kept even if every addr on it was filtered
 *  (e.g. a pure loopback), so callers can still see "lo" with addrs=[] instead
 *  of silently dropping the interface. */
export declare function parseIpAddr(text: string): InterfaceEntry[];
export declare function parseDefaultRoute(text: string): string | null;
/** `ss -lntp` -> listening sockets (process name kept when ss shows it). */
export declare function parseListen(text: string): ListenEntry[];
/** `ss -tnp` -> established/outgoing connections (remote ip/port + process). */
export declare function parseConnections(text: string): ConnectionEntry[];
export declare function parseHosts(text: string): Array<{
    ip: string;
    names: string[];
}>;
/** `ps -eo pid,ppid,user,%cpu,%mem,etime,args` */
export declare function parsePs(text: string): ProcessEntry[];
export declare function parseServices(text: string): string[];
/** `jps -lv`: "<pid> <main class> <args>" */
export declare function parseJps(text: string): JavaProcess[];
/** `docker ps` (default table layout).
 *  The header position varies by KoKo/docker version; the safest split is by
 *  2+ spaces, which matches the column boundaries `docker ps` prints. */
export declare function parseDockerPs(text: string): ContainerEntry[];
/** nginx config (`nginx -T`): upstream blocks, proxy_pass targets, server_name. */
export declare function parseNginxConfig(text: string): {
    upstreams: NginxUpstream[];
    proxies: string[];
    serverNames: string[];
};
/** Role detection: only from evidence that is actually present. */
export declare function detectRoles(inv: HostInventory): string[];
/** Apply one probe's output onto the inventory (keyed by probe id). */
export declare function applyProbe(inv: HostInventory, id: string, output: string, exitCode: number | null, command?: string): void;
