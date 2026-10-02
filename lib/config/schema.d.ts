import z from '@deepseek-ai/schemastery';
import { type JumpServerConfig } from './types.js';
/**
 * The settings-card schema is the UI contract: every field here renders on the
 * DSH Plugins page.
 *
 * EVERY field is marked `.volatile()`. That is not cosmetic: the Host's
 * `SettingsForms.volatileForm()` returns undefined unless at least one field
 * declares `meta.volatile`, and `describe()` then SKIPS this entry entirely —
 * so without it the namespace is never served, `configForms.whileServed()`
 * never fires, and the settings card silently never mounts. A plugin that
 * drops this marker looks healthy and renders nothing.
 *
 * volatile also means "applies live": every value below is read per call
 * through `getConfig()`, so an edit takes effect without a Host restart.
 *
 * Fields the model/UI must not hand-edit stay loosely typed on purpose (see
 * assetGroups below): schemastery's dict/nested schema drags cosmokit's Dict
 * into the emitted declaration (TS2742) and the settings card treats the
 * value as plain JSON anyway. Runtime access is defensively parsed in
 * src/config/types.ts + the owning module.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    autoOpenTerminal: z<boolean, boolean, "volatile-defined">;
    terminalScrollback: z<number, number, "volatile-defined">;
    host: z<string, string, "volatile-defined">;
    port: z<number, number, "volatile-defined">;
    username: z<string, string, "volatile-defined">;
    password: z<string, string, "volatile">;
    passwordEnv: z<string, string, "volatile-defined">;
    profiles: z<any, any, "volatile-defined">;
    activeProfileId: z<string, string, "volatile">;
    hostFingerprint: z<string, string, "volatile">;
    knownHostsPath: z<string, string, "volatile">;
    connectTimeout: z<number, number, "volatile-defined">;
    commandTimeout: z<number, number, "volatile-defined">;
    idleTimeout: z<number, number, "volatile-defined">;
    permissionMode: z<"READ_ONLY" | "AUTO" | "FULL_ACCESS", "READ_ONLY" | "AUTO" | "FULL_ACCESS", "volatile-defined">;
    privilegedReadInReadOnly: z<boolean, boolean, "volatile-defined">;
    manualPermissionMode: z<"FULL_ACCESS" | "FOLLOW_AGENT" | "CONFIRM_MODIFY", "FULL_ACCESS" | "FOLLOW_AGENT" | "CONFIRM_MODIFY", "volatile-defined">;
    timeZone: z<string, string, "volatile-defined">;
    allowedTargets: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    deniedTargets: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    batchConcurrency: z<number, number, "volatile-defined">;
    maxSessions: z<number, number, "volatile-defined">;
    consoleEnabled: z<boolean, boolean, "volatile-defined">;
    consolePort: z<number, number, "volatile-defined">;
    autoReconnect: z<boolean, boolean, "volatile-defined">;
    assetCacheTtlSeconds: z<number, number, "volatile-defined">;
    assetGroups: z<any, any, "volatile-defined">;
    runbooks: z<any, any, "volatile-defined">;
    riskJudge: z<any, any, "volatile-defined">;
    enableAudit: z<boolean, boolean, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: z<boolean, boolean, "volatile-defined">;
    autoOpenTerminal: z<boolean, boolean, "volatile-defined">;
    terminalScrollback: z<number, number, "volatile-defined">;
    host: z<string, string, "volatile-defined">;
    port: z<number, number, "volatile-defined">;
    username: z<string, string, "volatile-defined">;
    password: z<string, string, "volatile">;
    passwordEnv: z<string, string, "volatile-defined">;
    profiles: z<any, any, "volatile-defined">;
    activeProfileId: z<string, string, "volatile">;
    hostFingerprint: z<string, string, "volatile">;
    knownHostsPath: z<string, string, "volatile">;
    connectTimeout: z<number, number, "volatile-defined">;
    commandTimeout: z<number, number, "volatile-defined">;
    idleTimeout: z<number, number, "volatile-defined">;
    permissionMode: z<"READ_ONLY" | "AUTO" | "FULL_ACCESS", "READ_ONLY" | "AUTO" | "FULL_ACCESS", "volatile-defined">;
    privilegedReadInReadOnly: z<boolean, boolean, "volatile-defined">;
    manualPermissionMode: z<"FULL_ACCESS" | "FOLLOW_AGENT" | "CONFIRM_MODIFY", "FULL_ACCESS" | "FOLLOW_AGENT" | "CONFIRM_MODIFY", "volatile-defined">;
    timeZone: z<string, string, "volatile-defined">;
    allowedTargets: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    deniedTargets: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
    batchConcurrency: z<number, number, "volatile-defined">;
    maxSessions: z<number, number, "volatile-defined">;
    consoleEnabled: z<boolean, boolean, "volatile-defined">;
    consolePort: z<number, number, "volatile-defined">;
    autoReconnect: z<boolean, boolean, "volatile-defined">;
    assetCacheTtlSeconds: z<number, number, "volatile-defined">;
    assetGroups: z<any, any, "volatile-defined">;
    runbooks: z<any, any, "volatile-defined">;
    riskJudge: z<any, any, "volatile-defined">;
    enableAudit: z<boolean, boolean, "volatile-defined">;
}>>, "plain">;
export type Config = JumpServerConfig;
