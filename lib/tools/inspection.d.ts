import type { Context } from '@deepseek-ai/cordis';
import { type JumpServerConfig } from '../config/types.js';
import type { SessionRegistry } from '../jumpserver/session-registry.js';
import { type SessionGrant } from '../security/grant.js';
import { BaselineStore } from '../runtime/baseline-store.js';
export declare function registerCollectionTools(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, baselines: BaselineStore): Array<() => void>;
/** The directory the baseline store owns (kept next to the other DSH state). */
export declare function baselineDir(): string;
