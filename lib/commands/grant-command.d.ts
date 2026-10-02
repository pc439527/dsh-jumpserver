/**
 * The /jumpserver slash command (V0.2.4 P0): the ONLY way a conversation
 * receives a JumpServer Session Grant.
 *
 * Semantics:
 *   /jumpserver <task text>  -> ARMED_FOR_TURN: grant armed, task forwarded to
 *                               the agent via Agent.followup(), and the grant
 *                               auto-locks when that turn settles (agent idle)
 *                               or after the hard TTL, whichever comes first.
 *   /jumpserver on            -> persistent grant until /jumpserver off (or
 *                               session teardown/plugin dispose).
 *   /jumpserver (bare)        -> HELP ONLY, grants nothing (V0.2.5: a single
 *                               stray command must never unlock JumpServer).
 *   /jumpserver status        -> grant mode + live session state.
 *   /jumpserver off           -> revoke grant, close this conversation PTY,
 *                                clear the asset cache (human manual input then
 *                                has no live session to type into).
 *
 * The command is dispatched directly by the UI (never sent to the model), keyed
 * to the receiving agent session — the same id the jumpserver_* tools use.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { JumpServerConfig } from '../config/types.js';
import type { SessionRegistry } from '../jumpserver/session-registry.js';
import { type SessionGrant } from '../security/grant.js';
/**
 * Register /jumpserver. Returns the commands-service disposer so the plugin
 * can unregister on teardown. The commands service is optional in the host:
 * without it the plugin logs and continues (tools stay grant-locked).
 */
export declare function registerJumpServerCommand(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, terminateConversation?: (sessionId: string) => Promise<unknown>): (() => void) | null;
