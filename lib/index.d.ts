import { Context } from '@deepseek-ai/cordis';
import '@deepseek-ai/cordis-plugin-timer';
import { Config } from './config/schema.js';
import type { JumpServerConfig } from './config/types.js';
export declare const name = "dsh-jumpserver";
/**
 * ONLY services the base composition always mounts.
 *
 * V0.4.1: an unsatisfied inject is not an error — cordis simply never activates
 * the entry, which looked exactly like "the plugin is installed but does
 * nothing". `commands` / `systemPrompt` are therefore resolved through
 * `ctx.get` by jumpHostServices(), which degrades (no /jumpserver command, no
 * SOP section) instead of blocking the whole plugin.
 */
export declare const inject: readonly ["tools", "timer"];
export { Config };
export type { JumpServerConfig as PluginConfig };
export declare function apply(ctx: Context, config: JumpServerConfig): void;
