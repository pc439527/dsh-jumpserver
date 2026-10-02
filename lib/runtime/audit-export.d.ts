export type AuditExportFormat = 'csv' | 'json' | 'markdown';
export declare function serializeAudit(records: Array<Record<string, unknown>>, format: AuditExportFormat): string;
export declare function downloadAudit(records: Array<Record<string, unknown>>, format: AuditExportFormat): void;
