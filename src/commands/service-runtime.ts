/**
 * Cast-only access seam for optional DSH host services.
 *
 * The real /jumpserver command registry (ctx.commands) and the system-prompt
 * registry (ctx.systemPrompt) are host-composition services this plugin does
 * NOT depend on at build time (see service-types.ts). This file performs the
 * single structural cast the plugin needs; every consumer keeps working when
 * the host exposes them, and degrades gracefully when it does not.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerHostServices } from './service-types.js'

export function jumpHostServices(ctx: Context): JumpServerHostServices {
  return ctx as unknown as JumpServerHostServices
}

export type { CommandAgentLike } from './service-types.js'
