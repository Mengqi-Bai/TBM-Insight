import type { Context } from '@tbm-insight/cordis'
import type {} from '@tbm-insight/attachment'
import type { ImageMediaType } from '@tbm-insight/attachment'
import type { ImageBlock } from '@tbm-insight/llm'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, unlink, writeFile, rmdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { ResearchError, type ResearchMaterial, type ResearchUpload } from './research-store.ts'

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u
const DATA_TYPES = new Set(['csv', 'tsv', 'xlsx', 'json', 'parquet', 'txt', 'md', 'pdf', 'docx', 'zip'])
const imageTypes = new Map<string, ImageMediaType>([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']])

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !value.startsWith('.')
    && !/[<>:"/\\|?*\x00-\x1f]/u.test(value) && !/[ .]$/u.test(value)
}

async function checked(directory: string) {
  if (relative(directory, await realpath(directory)) !== '' || !(await lstat(directory)).isDirectory()) {
    throw new ResearchError(409, 'upload_directory', '无法打开项目的附件目录。')
  }
}

export async function saveResearchUpload(ctx: Context, request: Request, project: string, name: string | null): Promise<ResearchUpload> {
  if (!validName(name)) throw new ResearchError(400, 'invalid_filename', '附件文件名无效。')
  const kind = extname(name).slice(1).toLowerCase()
  const mediaType = imageTypes.get(kind)
  if (!mediaType && !DATA_TYPES.has(kind)) throw new ResearchError(415, 'upload_type', '支持 CSV、TSV、Excel、JSON、Parquet、文本、PDF、Word、ZIP，以及 PNG、JPEG、WebP 图片。')
  const sizeLimit = mediaType ? ctx.attachments.imageLimits.maxImageBytes : Infinity
  const tooLarge = () => new ResearchError(413, 'upload_size', '这张图片超过模型可接收的大小。可缩小后再添加。')
  if (Number(request.headers.get('content-length')) > sizeLimit) throw tooLarge()
  const id = randomUUID()
  let size = 0
  const content = async function* () {
    const reader = request.body?.getReader()
    if (!reader) return
    try {
      while (true) {
        request.signal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > sizeLimit) throw tooLarge()
        yield chunk.value
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  const base = join(project, 'uploads')
  await mkdir(base, { recursive: true })
  await checked(base)
  const folder = join(base, id)
  await mkdir(folder)
  const path = join(folder, 'content')
  const meta = join(folder, 'metadata.json')
  try {
    await writeFile(path, content(), { flag: 'wx', mode: 0o600, signal: request.signal })
    if (!size) throw new ResearchError(400, 'empty_upload', '附件为空。')
    let image: ImageBlock['attachment'] | undefined
    if (mediaType) {
      try { image = await ctx.attachments.saveImage({ data: await readFile(path), mediaType, name }) }
      catch { throw new ResearchError(400, 'invalid_image', '图片无法解码或超过图片尺寸限制。') }
    }
    const upload = { id, name, size, kind }
    await writeFile(meta, JSON.stringify({ ...upload, ...(image ? { image } : {}) }), { flag: 'wx', mode: 0o600 })
    return upload
  } catch (error) {
    await unlink(meta).catch(() => {})
    await unlink(path).catch(() => {})
    await rmdir(folder).catch(() => {})
    throw error
  }
}

export async function readResearchUpload(project: string, id: unknown) {
  if (typeof id !== 'string' || !UUID.test(id)) throw new ResearchError(400, 'invalid_upload', '附件编号无效。')
  try {
    const folder = join(project, 'uploads', id)
    await checked(folder)
    const metadata = join(folder, 'metadata.json')
    if (relative(metadata, await realpath(metadata)) !== '' || (await lstat(metadata)).size > 4096) throw new Error()
    const saved = JSON.parse(await readFile(metadata, 'utf8')) as ResearchUpload & { image?: ImageBlock['attachment'] }
    const path = join(folder, 'content')
    const stat = await lstat(path)
    if (saved.id !== id || !validName(saved.name) || extname(saved.name).slice(1).toLowerCase() !== saved.kind
      || !stat.isFile() || stat.size !== saved.size || !saved.size
      || relative(path, await realpath(path)) !== '') throw new Error()
    return { upload: { id, name: saved.name, size: saved.size, kind: saved.kind }, path, image: saved.image,
      mediaType: saved.image ? imageTypes.get(saved.kind) : undefined }
  } catch { throw new ResearchError(404, 'upload_not_found', '找不到此项目的附件。') }
}

export async function researchUploadInputs(project: string, ids: unknown) {
  if (ids === undefined) return { uploads: [], materials: [], images: [] }
  if (!Array.isArray(ids)) throw new ResearchError(400, 'invalid_upload', '附件清单无效。')
  const uploads: ResearchUpload[] = []
  const materials: ResearchMaterial[] = []
  const images: ImageBlock[] = []
  for (const id of new Set(ids)) {
    const { upload, path, image } = await readResearchUpload(project, id)
    uploads.push(upload)
    materials.push({ name: upload.name, kind: upload.kind, size: upload.size, path, ...(image ? { image } : {}) })
    if (image) images.push({ type: 'image', attachment: image })
  }
  return { uploads, materials, images }
}
