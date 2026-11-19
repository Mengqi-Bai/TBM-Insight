import type { Context } from '@tbm-insight/cordis'
import { createSnapshotStore } from '@tbm-insight/client-store'
import { IconChecklistOutlineRegular, IconGaugeOutlineRegular, IconSearchOutlineRegular, IconSettingsOutlineRegular } from '@tbm-insight/client-ui-primitives'
import type { MainPanelId } from '@tbm-insight/client-ui-layout/client'
import type {} from '@tbm-insight/client-ui-settings/client'
import { PANELS, record, rows, strings, text, type ConditionRange, type Filters, type Panel, type PanelInjected, type PanelOptions, type PanelResponse, type Viewing } from './contracts.ts'
import { NS, zh } from './locales.ts'
import { TbmPanel } from './TbmPanel.tsx'
import { DataSourcesSection, type SourcePaths } from './DataSourcesSection.tsx'

const ICONS = {
  progress: IconChecklistOutlineRegular,
  conditions: IconGaugeOutlineRegular,
  cutters: IconSettingsOutlineRegular,
  evidence: IconSearchOutlineRegular,
} as const

const CACHE_TTL = 3 * 60_000
const RESULT_CACHE_SIZE = 18

function filterKey(panel: Panel, filters: Filters): string {
  return `${panel}:${JSON.stringify(filters, Object.keys(filters).sort())}`
}

function recent<T>(cache: Map<string, { value: T; expires: number }>, key: string): T | undefined {
  const entry = cache.get(key)
  return entry !== undefined && entry.expires > Date.now() ? entry.value : undefined
}

async function readPanelResponse(response: Response, panel: Panel) {
  const result = record(await response.json().catch(() => undefined))
  if (!response.ok || result.status === 'error') throw new Error(text(record(result.error).message))
  if (result.panel !== panel || result.mode !== 'history' || typeof result.status !== 'string') throw new Error()
  return { status: result.status, origin: text(result.data_origin), data: record(result.data) }
}

function panelId(panel: Panel): MainPanelId {
  return `tbm-${panel}` as MainPanelId
}

/** Register the business panels for the profile that exposes the TBM API. */
export function registerTbmPanels(ctx: Context, openDraft: PanelInjected['openDraft']): void {
  if (typeof document === 'undefined' || !/^https?:/u.test(document.baseURI)) return
  ctx.effect(() => {
    const controller = new AbortController()
    const url = new URL('./api/tbm/panels', document.baseURI)
    const fileUrl = (path: string) => {
      if (/^\/api\/tbm\/evidence-source\?/u.test(path)) return new URL(path, document.baseURI).href
      if (!/^(?:[A-Za-z]:[\\/]|\/)/u.test(path)) return ''
      const target = new URL('./api/tbm/panel-file', document.baseURI)
      target.searchParams.set('path', path)
      return target.href
    }
    let dispose: (() => void) | undefined
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) return
        const status = record(await response.json())
        if (status.capability !== 'tbm-panels' || status.status !== 'ready' || controller.signal.aborted) return
        const viewing = createSnapshotStore<Viewing>({})
        const optionsCache = new Map<string, { value: PanelOptions; expires: number }>()
        const resultCache = new Map<string, { value: PanelResponse; expires: number }>()
        const lastQuery = new Map<Panel, Filters>()
        const sourceUrl = new URL('./api/tbm/data-sources', document.baseURI)
        const readSources = async (response: Response): Promise<SourcePaths> => {
          const value = record(await response.json().catch(() => undefined))
          if (!response.ok) throw new Error(text(record(value.error).message) || '无法读取工程数据设置。')
          return { dataDir: text(value.dataDir), cutterSource: text(value.cutterSource), knowledgeDir: text(value.knowledgeDir) }
        }
        const workspace = ctx.get('uiWorkspace') as { pickDirectory?: () => Promise<string | undefined> } | undefined
        const sourceSettings = {
          load: async (signal: AbortSignal) => readSources(await fetch(sourceUrl, { signal })),
          save: async (paths: SourcePaths) => {
            const saved = await readSources(await fetch(sourceUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(paths),
            }))
            optionsCache.clear()
            resultCache.clear()
            lastQuery.clear()
            viewing.set({ sourceRevision: (viewing.getSnapshot().sourceRevision ?? 0) + 1 })
            return saved
          },
          ...(workspace?.pickDirectory ? { pickDirectory: workspace.pickDirectory.bind(workspace) } : {}),
        }
        const t = ctx.locale.bind(NS)
        const disposeLocale = ctx.locale.register(NS, { zh, en: zh })
        const slots = PANELS.flatMap((panel, index) => {
          const id = panelId(panel)
          const optionsKey = panel === 'conditions' ? 'progress' : panel
          const peekOptions = () => recent(optionsCache, optionsKey)
          const peekResult = (filters: Filters) => recent(resultCache, filterKey(panel, filters))
          const options: PanelInjected['options'] = async signal => {
            const saved = peekOptions()
            if (saved !== undefined) return saved
            const target = new URL('./api/tbm/panel-options', document.baseURI)
            target.search = new URLSearchParams({ panel, mode: 'history' }).toString()
            const data = (await readPanelResponse(await fetch(target, { signal }), panel)).data
            const value = { dates: strings(data.dates), defaultDate: text(data.default_date), regions: strings(data.regions),
              documents: rows(data.documents) }
            if (!signal.aborted) optionsCache.set(optionsKey, { value, expires: Date.now() + CACHE_TTL })
            return value
          }
          const load: PanelInjected['load'] = async (filters, signal) => {
            const saved = peekResult(filters)
            if (saved !== undefined) return saved
            const response = await fetch(url, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ panel, mode: 'history', ...filters }), signal,
            })
            const value = await readPanelResponse(response, panel)
            if (!signal.aborted && value.status !== 'index_pending') {
              const key = filterKey(panel, filters)
              resultCache.delete(key)
              resultCache.set(key, { value, expires: Date.now() + CACHE_TTL })
              const oldest = resultCache.keys().next()
              if (resultCache.size > RESULT_CACHE_SIZE && !oldest.done) resultCache.delete(oldest.value)
            }
            return value
          }
          return [
            ctx.slots.inject('main', () => ctx.slots.register({
              name: 'main', key: id, locale: NS,
              inject: (): PanelInjected => ({
                panel,
                hooks: { viewing },
                openConditions: (conditionRange: ConditionRange) => {
                  lastQuery.delete('conditions')
                  viewing.set({ ...viewing.getSnapshot(), conditionRange })
                  ctx.layout.selectPanel(panelId('conditions'))
                },
                rememberWeek: (week, progressDate) => {
                  const current = viewing.getSnapshot()
                  if (current.week?.start_date === week.start_date && current.week.end_date === week.end_date && current.progressDate === progressDate) return
                  viewing.set({ ...current, week, progressDate })
                },
                openDraft,
                options,
                peekOptions,
                load,
                peekResult,
                peekQuery: () => lastQuery.get(panel),
                rememberQuery: filters => {
                  if (filters === undefined) lastQuery.delete(panel)
                  else lastQuery.set(panel, filters)
                },
                fileUrl,
              }),
            }, TbmPanel)),
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
              name: 'sidebar.panellist', id, order: -40 + index, locale: NS,
              label: () => t(panel),
            }, ICONS[panel])),
          ]
        })
        slots.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'tbm-data', order: 12, label: () => '工程数据', inject: () => sourceSettings,
        }, DataSourcesSection)))
        dispose = () => { for (const stop of slots.reverse()) stop(); disposeLocale() }
      } catch (error) {
        // Stock profiles and unavailable routes have no business-panel capability.
        if (!controller.signal.aborted && !(error instanceof TypeError)) console.warn('TBM panel discovery failed:', error)
      }
    })()
    return () => { controller.abort(); dispose?.() }
  }, 'ui-sidebar: TBM engineering panels')
}
