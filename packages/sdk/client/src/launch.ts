/**
 * Resolve the public SDK launch configuration to one tbm subprocess.
 * @module @tbm-insight/sdk-client/launch
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HarnessClientOptions } from './types.ts'

/** Default bound for a profile to answer the SDK initialize handshake. */
export const DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000

/** Internal generic process launch used by the transport and fake-runtime tests. */
export interface RuntimeProcessOptions {
  command: string
  args: string[]
  cwd?: string
  /** Materialize the complete child environment when the client starts its subprocess. */
  environment: () => NodeJS.ProcessEnv
  description: string
  initializeTimeoutMs: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  disposeEofGraceMs?: number
  disposeGraceMs?: number
}

/** Node argv plus internal profile patches required by one resolved tbm entry. */
export interface TbmNodeLaunch {
  /** Arguments before the profile selector. */
  nodeArgs: string[]
  /** Internal patches applied below caller-supplied patches. */
  patches: string[]
  /** Environment values required by the resolved entry mode. */
  environment: NodeJS.ProcessEnv
}

interface PackageManifest {
  version?: unknown
  bin?: unknown
}

/** Read a package manifest from one resolved package.json URL. */
function manifest(url: string): PackageManifest {
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/**
 * Resolve and version-check a tbm executable from package manifests.
 * @param tbmManifestUrl - resolved URL of the tbm package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @returns the absolute tbm executable path.
 */
export function resolveTbmBinFromManifests(tbmManifestUrl: string, clientManifestUrl: string): string {
  const tbmManifest = manifest(tbmManifestUrl)
  const clientManifest = manifest(clientManifestUrl)
  if (typeof tbmManifest.version !== 'string' || tbmManifest.version !== clientManifest.version) {
    throw new Error(`tbm SDK client ${String(clientManifest.version)} requires the same tbm version, got ${String(tbmManifest.version)}`)
  }
  const bin = typeof tbmManifest.bin === 'object' && tbmManifest.bin !== null
    ? (tbmManifest.bin as Record<string, unknown>).tbm
    : tbmManifest.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@tbm-insight/cli declares no tbm executable')
  return resolve(dirname(fileURLToPath(tbmManifestUrl)), bin)
}

/**
 * Resolve and version-check the built tbm executable installed with this SDK.
 * @returns the absolute built executable path, whether or not it exists in a source checkout.
 */
export function installedTbmBin(): string {
  return resolveTbmBinFromManifests(
    import.meta.resolve('@tbm-insight/cli/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve the Node launch for one same-version tbm package.
 * @param tbmManifestUrl - resolved URL of the tbm package manifest.
 * @param clientManifestUrl - resolved URL of the SDK client manifest.
 * @param sourceLoaderUrl - optional absolute tsx loader URL for deterministic tests.
 * @returns built output, or the source entry plus its compatibility patch and tsx environment.
 */
export function resolveTbmNodeLaunchFromManifests(
  tbmManifestUrl: string,
  clientManifestUrl: string,
  sourceLoaderUrl?: string,
): TbmNodeLaunch {
  const bin = resolveTbmBinFromManifests(tbmManifestUrl, clientManifestUrl)
  if (existsSync(bin)) return { nodeArgs: [bin], patches: [], environment: {} }

  const packageDir = dirname(fileURLToPath(tbmManifestUrl))
  const sourceBin = resolve(packageDir, 'src/bin.ts')
  const sourcePatch = resolve(packageDir, 'src/sdk-source.cordis.patch.yml')
  const sourceTsconfig = resolve(packageDir, 'tsconfig.json')
  if (!existsSync(sourceBin) || !existsSync(sourcePatch) || !existsSync(sourceTsconfig)) {
    throw new Error(
      `@tbm-insight/cli is missing its built executable ${bin} and complete source launch files ${sourceBin}, ${sourcePatch}, ${sourceTsconfig}`,
    )
  }
  const loader = sourceLoaderUrl ?? import.meta.resolve('tsx/esm')
  return {
    nodeArgs: ['--import', loader, sourceBin],
    patches: [sourcePatch],
    environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
  }
}

/**
 * Resolve the installed tbm package to a built or source Node launch.
 * @returns the launch descriptor for the current checkout or installed package.
 */
function installedTbmNodeLaunch(): TbmNodeLaunch {
  return resolveTbmNodeLaunchFromManifests(
    import.meta.resolve('@tbm-insight/cli/package.json'),
    new URL('../package.json', import.meta.url).href,
  )
}

/**
 * Resolve caller-relative filesystem inputs and construct canonical tbm argv.
 * @param options - public SDK launch options.
 * @param callerCwd - parent-process directory used for lexical resolution.
 * @returns one generic subprocess spec for the JSON-RPC transport.
 */
export function resolveTbmLaunch(
  options: HarnessClientOptions = {},
  callerCwd: string = process.cwd(),
): RuntimeProcessOptions {
  const profile = options.profile ?? 'sdk'
  const tbmLaunch = options.tbmBin === undefined
    ? installedTbmNodeLaunch()
    : { nodeArgs: [resolve(callerCwd, options.tbmBin)], patches: [], environment: {} }
  const patches = [
    ...tbmLaunch.patches,
    ...(options.patches ?? []).map(path => resolve(callerCwd, path)),
  ]
  const tbmHome = options.tbmHome === undefined ? undefined : resolve(callerCwd, options.tbmHome)
  return {
    command: process.execPath,
    args: [...tbmLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])],
    ...options.processCwd === undefined ? {} : { cwd: resolve(callerCwd, options.processCwd) },
    environment: () => ({
      ...(options.env ?? process.env),
      ...tbmLaunch.environment,
      ...tbmHome === undefined ? {} : { TBM_ENGINE_HOME: tbmHome },
    }),
    description: `tbm profile ${JSON.stringify(profile)}`,
    initializeTimeoutMs: options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS,
    ...options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs },
    ...options.shutdownTimeoutMs === undefined ? {} : { shutdownTimeoutMs: options.shutdownTimeoutMs },
    ...options.disposeEofGraceMs === undefined ? {} : { disposeEofGraceMs: options.disposeEofGraceMs },
    ...options.disposeGraceMs === undefined ? {} : { disposeGraceMs: options.disposeGraceMs },
  }
}
