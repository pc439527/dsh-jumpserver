/**
 * Audit row presentation helpers shared by the DSH Desktop settings surfaces and
 * the loopback console. Pure functions only: no React, no DOM, no transport, so
 * the refusal/failure semantics stay testable without a browser.
 */
/**
 * Storage is always UTC; only display follows the configured zone.
 *
 * This module hardcoded Asia/Shanghai, so every surface showed UTC+8 regardless
 * of the operator's setting. The zone is a parameter now, and runtime/time.ts is
 * the single source for resolving it.
 */
export function formatAuditTime(value, timeZone) {
    const raw = String(value ?? '');
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
        try {
            return new Intl.DateTimeFormat('zh-CN', {
                timeZone,
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
            }).format(date);
        }
        catch {
            // An unusable zone must still show the record rather than blank it out.
            return date.toISOString().replace('T', ' ').slice(11, 19);
        }
    }
    return raw.length > 19 ? raw.slice(11, 19) : raw;
}
export function auditEventType(record) {
    const explicit = String(record['eventType'] ?? '').trim();
    if (explicit.length > 0)
        return explicit;
    switch (String(record['operation'] ?? '')) {
        case 'exec':
        case 'run':
        case 'run-batch-cmd': return 'COMMAND';
        case 'list-assets': return 'ASSET_LIST';
        case 'enter': return 'ASSET_ENTER';
        case 'leave': return 'ASSET_LEAVE';
        case 'close': return 'DISCONNECT';
        case 'connect': return 'CONNECT';
        default: return 'EVENT';
    }
}
export function auditEventLabel(record) {
    switch (auditEventType(record)) {
        case 'ASSET_LIST': return '刷新资产列表';
        case 'ASSET_ENTER': return '进入资产';
        case 'ASSET_LEAVE': return '返回堡垒机';
        case 'CONNECT': return '连接 JumpServer';
        case 'DISCONNECT': return '关闭 JumpServer';
        default: return String(record['operation'] ?? '系统事件');
    }
}
/** A refusal is the policy working, not a crash — never render it red. */
export function auditRefused(record) {
    const result = String(record['result'] ?? '');
    return result === 'BLOCKED' || result === 'DENIED' || String(record['refusalReason'] ?? '').length > 0;
}
/** Why a refused command was refused (the gate's own reason). */
export function auditRefusalLabel(record) {
    const why = String(record['refusalReason'] ?? '');
    const denied = String(record['result'] ?? '') === 'DENIED';
    return (denied ? '未批准' : '已拦截') + (why.length > 0 ? '：' + why : '');
}
export function auditFailed(record) {
    if (auditRefused(record))
        return false;
    const result = String(record['result'] ?? '');
    const exit = record['exitCode'];
    return (result !== 'ok' && result !== 'COMPLETED' && result !== 'ASSET_LIST_EMPTY') || (typeof exit === 'number' && exit !== 0);
}
