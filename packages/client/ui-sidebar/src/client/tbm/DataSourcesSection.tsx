import { useEffect, useState, type FormEvent } from 'react'
import type { InjectFace } from '@tbm-insight/client-ui-slots'
import css from './TbmPanel.module.css'

const fields = {
  dataDir: ['PLC 数据目录', '包含设备按日归档的 ZIP 文件夹'],
  cutterSource: ['换刀台账', '刀具更换信息统计表的完整 .xlsx 路径'],
  knowledgeDir: ['规范与案例库', '已有索引的知识库目录，可留空'],
} as const
type Key = keyof typeof fields
const keys = Object.keys(fields) as Key[]
export type SourcePaths = Record<Key, string>
interface SourceSettings {
  load: (signal: AbortSignal) => Promise<SourcePaths>
  save: (paths: SourcePaths) => Promise<SourcePaths>
  pickDirectory?: () => Promise<string | undefined>
}

export function DataSourcesSection({ load, save, pickDirectory }: InjectFace<SourceSettings>) {
  const [paths, setPaths] = useState<SourcePaths>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal).then(setPaths, failure => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => { controller.abort() }
  }, [load])
  const change = (key: Key, value: string) => {
    setSaved(false)
    setPaths(previous => previous && { ...previous, [key]: value })
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!paths || working) return
    setWorking(true); setError(''); setSaved(false)
    try { setPaths(await save(paths)); setSaved(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '无法保存数据源。') }
    finally { setWorking(false) }
  }
  return <form className={css.sourceSettings} onSubmit={submit}>
    <h2>工程数据</h2>
    {paths && keys.map(key => <div key={key} className={css.sourceSetting}>
      <label>
        <strong>{fields[key][0]}</strong>
        <span>{fields[key][1]}</span>
        <input value={paths[key]} onChange={event => change(key, event.currentTarget.value)} disabled={working} />
      </label>
      {key !== 'cutterSource' && pickDirectory && <button className={css.secondary} type="button" disabled={working} onClick={() => {
        void pickDirectory().then(value => { if (value) change(key, value) }, () => { setError('无法打开目录选择窗口。') })
      }}>选择文件夹</button>}
    </div>)}
    {paths && <button className={css.primary} type="submit" disabled={working}>{working ? '正在保存…' : '保存数据源'}</button>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">已保存，接下来的查询将使用这些路径。</p>}
  </form>
}
