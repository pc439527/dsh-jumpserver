/**
 * Client-side version identity (V0.2.6 P0 version handshake).
 *
 * __DSHJS_CLIENT_VERSION__ / __DSHJS_CLIENT_BUILD__ are compile-time constants
 * injected by scripts/build-client.mjs (esbuild define, sourced from
 * lib/build-meta.json). In tests / un-built consumption they fall back to
 * 'dev' (typeof-guarded, so Node/vitest never throws on the undeclared
 * symbol). The sidebar compares these against the Host's pluginVersion /
 * hostBuild (from the /api/jumpserver.status payload) to surface a
 * "restart dsh web" warning whenever they diverge.
 */

declare const __DSHJS_CLIENT_VERSION__: string | undefined
declare const __DSHJS_CLIENT_BUILD__: string | undefined

function defined(value: string | undefined): boolean {
  return typeof value === 'string' && value.length > 0
}

const clientVersionValue: string | undefined = typeof __DSHJS_CLIENT_VERSION__ === 'string' ? __DSHJS_CLIENT_VERSION__ : undefined
const clientBuildValue: string | undefined = typeof __DSHJS_CLIENT_BUILD__ === 'string' ? __DSHJS_CLIENT_BUILD__ : undefined

export const CLIENT_VERSION: string = defined(clientVersionValue) ? (clientVersionValue as string) : 'dev'
export const CLIENT_BUILD: string = defined(clientBuildValue) ? (clientBuildValue as string) : 'dev'
