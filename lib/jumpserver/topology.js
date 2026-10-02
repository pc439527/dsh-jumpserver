function ipsOf(inv) {
    const out = new Set();
    for (const iface of inv.interfaces) {
        for (const addr of iface.addrs) {
            if (!addr.startsWith('127.') && !addr.startsWith('fe80') && !addr.startsWith('::1'))
                out.add(addr);
        }
    }
    return [...out];
}
function nodeOf(inventories) {
    return inventories.map((inv) => ({
        target: inv.target,
        hostname: inv.hostname,
        reachable: inv.reachable,
        error: inv.error,
        roles: inv.roles,
        os: inv.os.name !== null ? [inv.os.name, inv.os.version].filter(Boolean).join(' ') : null,
        kernel: inv.kernel,
        uptime: inv.uptime,
        load: inv.load,
        cores: inv.cores,
        memoryUsedPct: inv.memory.usedPct,
        ports: [...new Set(inv.listening.map((l) => l.port))].sort((a, b) => a - b),
        ips: ipsOf(inv),
        services: inv.services.length,
        processes: inv.processes.length,
        containers: inv.containers.length,
    }));
}
/** Resolve a probe string (host or IP) to one of the surveyed nodes. */
function resolvePeer(nodes, self, host) {
    const needle = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    if (needle.length === 0)
        return null;
    if (needle === 'localhost' || needle.startsWith('127.') || needle === '0.0.0.0')
        return null;
    for (const node of nodes) {
        if (node === self)
            continue;
        if (node.ips.some((ip) => ip.toLowerCase() === needle))
            return node;
        const hostname = node.hostname?.toLowerCase();
        if (hostname !== null && hostname !== undefined && hostname.length > 0) {
            if (hostname === needle)
                return node;
            // "oa-app-01.weaver.local" matches hostname "oa-app-01"
            if (needle.startsWith(hostname + '.') || hostname.startsWith(needle + '.'))
                return node;
        }
        if (node.target.toLowerCase() === needle)
            return node;
    }
    return null;
}
function pushEdge(edges, edge) {
    const duplicate = edges.find((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type && e.port === edge.port);
    if (duplicate === undefined) {
        edges.push(edge);
        return;
    }
    for (const item of edge.evidence) {
        if (!duplicate.evidence.includes(item))
            duplicate.evidence.push(item);
    }
    // strongest evidence wins
    if (edge.confidence === 'HIGH')
        duplicate.confidence = 'HIGH';
}
export function buildTopology(inventories, options = {}) {
    const depth = Math.max(1, Math.min(3, Math.floor(options.depth ?? 1)));
    const warnings = [];
    const nodes = nodeOf(inventories);
    const edges = [];
    const sourceByTarget = new Map(inventories.map((inv, index) => [inv.target, inventories[index]]));
    const reachable = new Set(nodes.filter((n) => n.reachable).map((n) => n.target));
    for (const inv of inventories) {
        const self = nodes.find((n) => n.target === inv.target);
        if (self === undefined)
            continue;
        if (!inv.reachable) {
            warnings.push(inv.target + ' 不可达（' + (inv.error ?? 'navigation failed') + '）：该节点无拓扑证据');
            continue;
        }
        // ---- nginx upstream blocks ----
        for (const upstream of inv.nginx?.upstreams ?? []) {
            for (const server of upstream.servers) {
                const peer = resolvePeer(nodes, self, server.host);
                if (peer === null)
                    continue;
                const evidence = ['nginx upstream "' + upstream.name + '" -> ' + server.host + (server.port !== null ? ':' + server.port : '')];
                const listens = sourceByTarget.get(peer.target)?.listening ?? [];
                if (server.port !== null && listens.some((l) => l.port === server.port)) {
                    evidence.push('peer listens on ' + String(server.port));
                }
                pushEdge(edges, {
                    from: self.target,
                    to: peer.target,
                    type: 'reverse_proxy',
                    port: server.port,
                    confidence: 'HIGH',
                    evidence,
                });
            }
        }
        // ---- proxy_pass targets ----
        for (const proxy of inv.nginx?.proxies ?? []) {
            const match = /^https?:\/\/([^/:;\s]+)(?::(\d+))?/.exec(proxy);
            if (match === null)
                continue;
            const peer = resolvePeer(nodes, self, match[1] ?? '');
            if (peer === null)
                continue;
            const port = match[2] !== undefined ? Number(match[2]) : null;
            pushEdge(edges, {
                from: self.target,
                to: peer.target,
                type: 'reverse_proxy',
                port,
                confidence: 'HIGH',
                evidence: ['proxy_pass ' + proxy],
            });
        }
        // ---- established sockets ----
        const remoteSeen = new Set();
        for (const conn of inv.connections) {
            const peer = resolvePeer(nodes, self, conn.remoteIp);
            if (peer === null)
                continue;
            // An edge that touches an unreachable peer would be evidence of a
            // connection that never actually got measured on the other end — drop it.
            if (!reachable.has(peer.target))
                continue;
            const key = peer.target + ':' + (conn.remotePort ?? '');
            if (remoteSeen.has(key))
                continue;
            remoteSeen.add(key);
            const listens = sourceByTarget.get(peer.target)?.listening ?? [];
            const confirmed = conn.remotePort !== null && listens.some((l) => l.port === conn.remotePort);
            pushEdge(edges, {
                from: self.target,
                to: peer.target,
                type: 'tcp_client',
                port: conn.remotePort,
                confidence: confirmed ? 'HIGH' : 'MEDIUM',
                evidence: [
                    'ESTABLISHED ' + conn.remoteIp + (conn.remotePort !== null ? ':' + conn.remotePort : '') +
                        (conn.process !== null ? ' (' + conn.process + ')' : ''),
                    ...(confirmed ? ['peer listens on ' + String(conn.remotePort)] : []),
                ],
            });
        }
        // ---- /etc/hosts aliases ----
        for (const entry of inv.hosts) {
            const peer = resolvePeer(nodes, self, entry.ip);
            if (peer === null)
                continue;
            pushEdge(edges, {
                from: self.target,
                to: peer.target,
                type: 'hosts_alias',
                port: null,
                confidence: 'MEDIUM',
                evidence: ['/etc/hosts: ' + entry.ip + ' ' + entry.names.join(' ')],
            });
        }
    }
    if (depth >= 2) {
        // Nodes behind the SAME upstream of the SAME proxy are peers (an OA app
        // cluster behind one nginx). Evidence = the shared upstream block.
        const groups = new Map();
        for (const edge of edges) {
            if (edge.type !== 'reverse_proxy')
                continue;
            const key = edge.from + '\u0000' + edge.port;
            const group = groups.get(key) ?? { proxy: edge.from, upstream: key, members: [] };
            if (!group.members.includes(edge.to))
                group.members.push(edge.to);
            groups.set(key, group);
        }
        for (const group of groups.values()) {
            if (group.members.length < 2)
                continue;
            for (let i = 0; i < group.members.length; i++) {
                for (let j = i + 1; j < group.members.length; j++) {
                    const a = group.members[i];
                    const b = group.members[j];
                    pushEdge(edges, { from: a, to: b, type: 'same_upstream', port: null, confidence: 'MEDIUM', evidence: ['both serve upstream of ' + group.proxy] });
                    pushEdge(edges, { from: b, to: a, type: 'same_upstream', port: null, confidence: 'MEDIUM', evidence: ['both serve upstream of ' + group.proxy] });
                }
            }
        }
    }
    return { nodes, edges, warnings };
}
/** Plain-text tree for the model and the console (compact, evidence-annotated). */
export function renderTopology(topology) {
    const lines = [];
    for (const node of topology.nodes) {
        lines.push(node.target + (node.hostname !== null ? '  (' + node.hostname + ')' : ''));
        lines.push('  角色: ' + (node.roles.length > 0 ? node.roles.join(', ') : '未识别'));
        if (node.os !== null)
            lines.push('  OS: ' + node.os);
        if (node.ports.length > 0)
            lines.push('  端口: ' + node.ports.join(', '));
        const out = topology.edges.filter((e) => e.from === node.target && e.type !== 'same_upstream');
        if (out.length > 0) {
            lines.push('  出向:');
            for (const edge of out) {
                lines.push('    ├── ' + edge.type + ' :' + (edge.port ?? '?') + ' ──> ' + edge.to +
                    '  [' + edge.confidence + '] ' + edge.evidence[0]);
            }
        }
        if (!node.reachable)
            lines.push('  !! 不可达: ' + (node.error ?? '?'));
    }
    if (topology.warnings.length > 0) {
        lines.push('');
        for (const warning of topology.warnings)
            lines.push('note: ' + warning);
    }
    return lines.join('\n');
}
