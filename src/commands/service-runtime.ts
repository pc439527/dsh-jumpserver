/**
 * Access seam for OPTIONAL DSH host services (/jumpserver command registry,
 * system-prompt registry).
 *
 * V0.4.1: this used to be a plain structural cast (`ctx as JumpServerHostServices`),
 * which compiles but is wrong at runtime — cordis GUARDS service access, so
 * reading `ctx.commands` for a service the plugin did not declare in `inject`
 * throws "cannot get property \"commands\" without inject" and aborts whichever
 * phase touched it (the grant command and the SOP section, in that order).
 * `ctx.get(name)` is the sanctioned read for a service you do not inject:
 * absent means undefined and every consumer degrades.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandService, JumpServerHostServices, SystemPromptService } from './service-types.js'

export function jumpHostServices(ctx: Context): JumpServerHostServices {
  const read = (name: string): unknown =>
    typeof (ctx as { get?: (n: string) => unknown }).get === 'function'
      ? (ctx as { get: (n: string) => unknown }).get(name)
      : undefined
  return {
    commands: read('commands') as CommandService,
    systemPrompt: read('systemPrompt') as SystemPromptService,
  }
}

export type { CommandAgentLike } from './service-types.js'
