import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCT_ROOT = fileURLToPath(new URL('.', import.meta.url))
export const PRODUCT_HOME = process.env.TBM_INSIGHT_HOME || join(PRODUCT_ROOT, '.local')
const FILE = join(PRODUCT_HOME, 'data-sources.json')
const FIELDS = ['dataDir', 'cutterSource', 'knowledgeDir'] as const
export type DataSources = Record<typeof FIELDS[number], string>

export function dataSources(defaults: Partial<DataSources> = {}): DataSources {
  let saved: Partial<DataSources> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(FILE, 'utf8').replace(/^\uFEFF/u, ''))
    if (parsed && typeof parsed === 'object') saved = parsed as Partial<DataSources>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return Object.fromEntries(FIELDS.map(key => [key, typeof saved[key] === 'string' ? saved[key] : defaults[key] ?? ''])) as DataSources
}

async function cutterWorkbook(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const workbooks = entries.filter(entry => entry.isFile() && !entry.name.startsWith('~$')
    && extname(entry.name).toLowerCase() === '.xlsx')
  if (!workbooks.length) throw new Error('所选文件夹没有 .xlsx 台账，请选择台账所在的文件夹。')
  const original = workbooks.find(entry => entry.name.toLowerCase() === '刀具更换信息统计表.xlsx')
  const named = workbooks.filter(entry => /换刀|刀具更换|更换刀具/u.test(entry.name))
  const selected = original ?? (named.length === 1 ? named[0] : workbooks.length === 1 ? workbooks[0] : undefined)
  if (!selected) throw new Error('所选文件夹有多份 Excel，无法确定换刀台账。请填写台账文件的完整 .xlsx 路径。')
  return realpath(join(directory, selected.name))
}

async function checked(value: unknown, field: typeof FIELDS[number]): Promise<string> {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('数据路径无效。')
  const entered = value.trim().replace(/^"|"$/gu, '')
  if (!entered) return ''
  if (!isAbsolute(entered)) throw new Error('请填写完整的本机文件或目录路径。')
  const path = await realpath(entered).catch(() => { throw new Error(`找不到路径 ${entered}。`) })
  const info = await stat(path)
  if (field === 'cutterSource') {
    if (info.isDirectory()) return cutterWorkbook(path)
    if (!info.isFile() || extname(path).toLowerCase() !== '.xlsx') throw new Error('换刀台账请选择文件夹或 .xlsx 文件。')
  } else if (!info.isDirectory()) throw new Error('PLC 数据和知识库请选择目录。')
  return path
}

export async function saveDataSources(input: unknown): Promise<DataSources> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('请填写数据源配置。')
  const fields = input as Record<string, unknown>
  const value = Object.fromEntries(await Promise.all(FIELDS.map(async key => [key, await checked(fields[key], key)]))) as DataSources
  const temporary = join(dirname(FILE), `.data-sources-${randomUUID()}.tmp`)
  await mkdir(dirname(FILE), { recursive: true })
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, FILE)
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return value
}
