import type { Context } from '@tbm-insight/cordis'
import type { MainPanelId } from '@tbm-insight/client-ui-layout/client'
import { IconFolderOpenOutlineRegular } from '@tbm-insight/client-ui-primitives'
import { record, text } from '../tbm/contracts.ts'
import { parseCatalog, parseProject, parseUpload, type ResearchInjected } from './contracts.ts'
import { NS, zh } from './locales.ts'
import { ResearchPage } from './ResearchPage.tsx'

const id = 'tbm-research' as MainPanelId

async function read(response: Response) {
  const value = record(await response.json().catch(() => undefined))
  if (!response.ok || value.status === 'error') throw new Error(text(record(value.error).message) || text(value.message))
  return value
}

/** Register the research workspace when the Web profile exposes its API. */
export function registerResearchPage(ctx: Context): void {
  if (typeof document === 'undefined' || !/^https?:/u.test(document.baseURI)) return
  const workspace = ctx.get('uiWorkspace') as { pickDirectory?: NonNullable<ResearchInjected['pickDirectory']> } | undefined
  ctx.effect(() => {
    const controller = new AbortController()
    const endpoint = new URL('./api/tbm/research', document.baseURI)
    let cleanup: (() => void) | undefined
    let initial: ReturnType<typeof parseCatalog> | undefined
    const request: ResearchInjected['request'] = async (command, signal) => {
      const result = await read(await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command), ...(signal === undefined ? {} : { signal }),
      }))
      if (result.status === 'ok' && command.action === 'delete') return undefined
      const project = parseProject(result.project)
      if (result.status !== 'ok' || project === undefined) throw new Error()
      return project
    }
    const catalog: ResearchInjected['catalog'] = async signal => {
      if (initial !== undefined) {
        const snapshot = initial
        initial = undefined
        return snapshot
      }
      const result = await read(await fetch(endpoint, { signal, cache: 'no-store' }))
      if (result.status !== 'ready' || result.capability !== 'tbm-research') throw new Error()
      return parseCatalog(result)
    }
    const artifactUrl: ResearchInjected['artifactUrl'] = (projectId, runId, path, download) => {
      const target = new URL('./api/tbm/research-artifact', document.baseURI)
      target.search = new URLSearchParams({ projectId, runId, path, ...(download ? { download: '1' } : {}) }).toString()
      return target.href
    }
    const uploadUrl: NonNullable<ResearchInjected['uploadUrl']> = (projectId, id, download) => {
      const target = new URL('./api/tbm/research-attachment', document.baseURI)
      target.search = new URLSearchParams({ projectId, id, ...(download ? { download: '1' } : {}) }).toString()
      return target.href
    }
    const recordUrl: NonNullable<ResearchInjected['recordUrl']> = (projectId, id, kind) => {
      const target = new URL('./api/tbm/research-record', document.baseURI)
      target.search = new URLSearchParams(kind === 'file' ? { projectId, path: id } : { projectId, id }).toString()
      return target.href
    }
    const upload: NonNullable<ResearchInjected['upload']> = async (projectId, file) => {
      const target = new URL('./api/tbm/research-upload', document.baseURI)
      target.search = new URLSearchParams({ projectId, name: file.name }).toString()
      const result = await read(await fetch(target, { method: 'POST', body: file }))
      const item = parseUpload(result.upload)
      if (!item) throw new Error()
      return item
    }
    void (async () => {
      try {
        const discovery = await fetch(endpoint, { signal: controller.signal })
        if (!discovery.ok) return
        const result = await read(discovery)
        if (result.status !== 'ready' || result.capability !== 'tbm-research' || controller.signal.aborted) return
        initial = parseCatalog(result)
        const disposeLocale = ctx.locale.register(NS, { zh, en: zh })
        const t = ctx.locale.bind(NS)
        const disposers = [
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main', key: id, locale: NS,
            inject: (): ResearchInjected => ({ catalog, request, artifactUrl, uploadUrl, upload, recordUrl,
              ...(workspace?.pickDirectory ? { pickDirectory: workspace.pickDirectory.bind(workspace) } : {}) }),
          }, ResearchPage)),
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist', id, order: -36, locale: NS, label: () => t('research'),
          }, IconFolderOpenOutlineRegular)),
        ]
        cleanup = () => { for (const dispose of disposers.reverse()) dispose(); disposeLocale() }
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof TypeError)) console.warn('TBM research discovery failed:', error)
      }
    })()
    return () => { controller.abort(); cleanup?.() }
  }, 'ui-sidebar: TBM research')
}

