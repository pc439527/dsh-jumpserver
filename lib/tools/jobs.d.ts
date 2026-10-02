import type { Context } from '@deepseek-ai/cordis';
import type { JumpServerConfig } from '../config/types.js';
import type { SessionRegistry } from '../jumpserver/session-registry.js';
import type { SessionGrant } from '../security/grant.js';
import type { JobStore } from '../runtime/job-store.js';
export declare function registerJobTools(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, jobs: JobStore): Array<() => void>;
