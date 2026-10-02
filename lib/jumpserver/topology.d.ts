/**
 * Topology (V0.4.0): turn host inventories into a fact graph.
 *
 * Every edge carries EVIDENCE and a CONFIDENCE, because "99 -> 101" is only
 * useful when the reader knows WHY the connector believes it:
 *
 *   reverse_proxy  nginx upstream / proxy_pass in the collected config (HIGH)
 *   tcp_client     ESTABLISHED socket on the source toward the target (HIGH
 *                  when the target really listens on that port, MEDIUM else)
 *   hosts_alias    /etc/hosts maps a name onto another node's IP (MEDIUM)
 *   same_upstream  two nodes share one upstream block behind the same proxy
 *                  (MEDIUM, depth>=2 only)
 *
 * Nothing is inferred from naming conventions alone.
 */
import type { HostInventory } from './host-parse.js';
export type EdgeType = 'reverse_proxy' | 'tcp_client' | 'hosts_alias' | 'same_upstream';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export interface TopologyEdge {
    from: string;
    to: string;
    type: EdgeType;
    port: number | null;
    confidence: Confidence;
    evidence: string[];
}
export interface TopologyNode {
    target: string;
    hostname: string | null;
    reachable: boolean;
    error: string | null;
    roles: string[];
    os: string | null;
    kernel: string | null;
    uptime: string | null;
    load: number[] | null;
    cores: number | null;
    memoryUsedPct: number | null;
    ports: number[];
    ips: string[];
    services: number;
    processes: number;
    containers: number;
}
export interface Topology {
    nodes: TopologyNode[];
    edges: TopologyEdge[];
    warnings: string[];
}
export declare function buildTopology(inventories: HostInventory[], options?: {
    depth?: number;
}): Topology;
/** Plain-text tree for the model and the console (compact, evidence-annotated). */
export declare function renderTopology(topology: Topology): string;
