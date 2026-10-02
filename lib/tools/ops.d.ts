import type { Context } from '@deepseek-ai/cordis';
import type { JumpServerConfig } from '../config/types.js';
import type { SessionRegistry } from '../jumpserver/session-registry.js';
import { type SessionGrant } from '../security/grant.js';
import type { OpsCaseRegistry } from '../ops/evidence.js';
export declare function registerOpsTools(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, cases: OpsCaseRegistry): Array<() => void>;
