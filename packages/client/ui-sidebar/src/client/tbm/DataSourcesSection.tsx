import { useEffect, useId, useState, type FormEvent } from 'react'
import { Button, IconCheckCircleFillRegular, IconFolderOpenOutlineRegular, Input } from '@tbm-insight/client-ui-primitives'
import type { InjectFace } from '@tbm-insight/client-ui-slots'
import css from './DataSourcesSection.module.css'

const fields = {
  dataDir: ['PLC 数据目录', '包含设备按日归档的 ZIP 文件夹'],
  cutterSource: ['换刀台账', '选择台账所在文件夹，或填写 .xlsx 文件路径'],
  knowledgeDir: ['规范与案例库', '留空使用内置资料，也可选择已建索引的知识库目录'],
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
  const id = useId()
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
    setError('')
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
  return (
    <form className={css.section} onSubmit={submit}>
      <h2 className={css.title}>工程数据</h2>
      {paths ? (
        <div className={css.card}>
          {keys.map(key => {
            const inputId = `${id}-${key}`
            const helpId = `${inputId}-help`
            const [label, description] = fields[key]
            return (
              <div key={key} className={css.field}>
                <label className={css.label} htmlFor={inputId}>{label}</label>
                <p className={css.description} id={helpId}>{description}</p>
                <div className={css.controls}>
                  <Input
                    id={inputId}
                    className={css.path ?? ''}
                    aria-describedby={helpId}
                    placeholder={key === 'knowledgeDir' ? '使用内置规范与案例库' : undefined}
                    value={paths[key]}
                    onChange={event => change(key, event.currentTarget.value)}
                    spellCheck={false}
                    disabled={working}
                  />
                  {pickDirectory && (
                    <Button
                      variant="outline"
                      className={css.pickButton}
                      icon={<IconFolderOpenOutlineRegular size={16} aria-hidden />}
                      aria-label={`${label}：选择文件夹`}
                      disabled={working}
                      onClick={() => {
                        void pickDirectory().then(value => { if (value) change(key, value) }, () => { setError('无法打开目录选择窗口。') })
                      }}
                    >
                      选择文件夹
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : !error && <p className={css.description} role="status">正在读取数据源…</p>}
      {(paths || error) && (
        <div className={css.footer}>
          {error ? <p className={css.error} role="alert">{error}</p> : saved && (
            <p className={css.saved} role="status">
              <IconCheckCircleFillRegular size={14} aria-hidden />
              已保存，接下来的查询将使用这些路径。
            </p>
          )}
          {paths && (
            <Button variant="primary" type="submit" className={css.saveButton} disabled={working}>
              {working ? '正在保存…' : '保存数据源'}
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
