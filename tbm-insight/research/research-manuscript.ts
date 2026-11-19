/** Reproducible counts and layout checks for a Markdown manuscript. */

export const manuscriptScopes = ['body', 'abstract_zh', 'abstract_en', 'manuscript'] as const
export const manuscriptUnits = ['han', 'words', 'mixed', 'nonspace_characters'] as const

type Scope = typeof manuscriptScopes[number]
type Unit = typeof manuscriptUnits[number]
type SectionRole = 'title' | 'intro' | 'methods' | 'results' | 'discussion' | 'conclusion' | 'references'
  | 'abstract_zh' | 'abstract_en' | 'notes' | 'supplement' | 'other'

export interface ManuscriptBudget {
  scope: Scope
  unit: Unit
  min?: number
  max?: number
  includeCaptions?: boolean
  includeTables?: boolean
}

interface Issue { line: number; code: string; message: string }

function roleOf(heading: string): SectionRole | undefined {
  const text = heading.replace(/^[\d.．、]+\s*/u, '').trim().toLowerCase()
  if (/^(?:abstract\b|英文摘要)/u.test(text)) return 'abstract_en'
  if (/^(?:中文)?摘要/u.test(text)) return 'abstract_zh'
  if (/^(?:引言|绪论|研究背景|相关工作|introduction|related work)/u.test(text)) return 'intro'
  if (/^(?:工程概况|数据|材料与方法|研究方法|方法|试验设计|验证方案|method|materials? and methods?|data|study area)/u.test(text)) return 'methods'
  if (/^(?:结果|试验结果|实验结果|results?)/u.test(text)) return 'results'
  if (/^(?:讨论|discussion)/u.test(text)) return 'discussion'
  if (/^(?:结论|结语|conclusions?)/u.test(text)) return 'conclusion'
  if (/^(?:参考文献|references|bibliography)/u.test(text)) return 'references'
  if (/^(?:待完成|待办|工作记录|工作日志|版本说明|todo|draft notes)/u.test(text)) return 'notes'
  if (/^(?:附录|补充材料|supplement|appendix)/u.test(text)) return 'supplement'
  return undefined
}

function visible(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/gu, '')
    .replace(/[\x60*_~]|^\s*>+\s*/gu, '')
}

function counts(text: string) {
  const han = [...text.matchAll(/\p{Script=Han}/gu)].length
  const words = [...text.matchAll(/[\p{Script=Latin}\d]+(?:[’'.-][\p{Script=Latin}\d]+)*/gu)].length
  return { han, words, mixed: han + words, nonspace_characters: [...text.replace(/\s/gu, '')].length }
}

/** Count Markdown text and return line-linked checks for discussion with the author. */
export function inspectManuscript(text: string, budgets: readonly ManuscriptBudget[] = []) {
  const sections: Array<{ title: string; line: number; role: SectionRole; prose: string[] }> = []
  const chunks: Array<{ role: SectionRole; text: string; category: 'prose' | 'table' | 'caption' }> = []
  const issues: Issue[] = []
  let role: SectionRole = 'title'
  let fence = ''
  let foundTitle = false
  const levels: Array<{ depth: number; role: SectionRole }> = []
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const trimmed = raw.trim()
    const fenceMarker = /^(?:```+|~~~+)/u.exec(trimmed)?.[0]?.[0]
    if (fenceMarker) { if (!fence || fence === fenceMarker) fence = fence ? '' : fenceMarker; continue }
    if (fence || !trimmed || /^[-*_]{3,}$/u.test(trimmed)) continue
    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(raw)
    if (heading) {
      const depth = heading[1]!.length
      const title = visible(heading[2]!)
      while (levels.length && levels.at(-1)!.depth >= depth) levels.pop()
      role = depth === 1 && !foundTitle ? 'title' : roleOf(title) ?? levels.at(-1)?.role ?? 'other'
      if (role === 'title' && depth > 1) role = roleOf(title) ?? 'other'
      if (depth === 1) foundTitle = true
      levels.push({ depth, role })
      sections.push({ title, line, role, prose: [] })
      if (role === 'notes') issues.push({ line, code: 'draft_notes', message: '工作备注或待办应保存到独立项目记录。' })
      continue
    }
    const caption = /^(?:>\s*)?(?:\*\*)?(?:图|表|fig(?:ure)?\.?|table)\s*\d+[\s.．：:]/iu.test(trimmed)
    const table = raw.trimStart().startsWith('|')
    if (table && /^[|:\s-]+$/u.test(trimmed)) continue
    if (role !== 'references' && role !== 'notes' && role !== 'supplement' && !caption && !table) {
      if (/^\s*(?:[-+*]\s+|\d{1,3}[.、)）]\s*|[（(]\d{1,3}[）)]\s*)/u.test(raw)
        || ((role === 'abstract_zh' || role === 'conclusion') && /[：:；;]\s*\d{1,3}[）)]/u.test(raw))) {
        issues.push({ line, code: 'prose_list', message: '检查此处的分点表达，按期刊体例改为连贯段落。' })
      }
      if (role === 'title' && /投稿目标|稿件版本|版本号|基于最终结果集/u.test(raw)) {
        issues.push({ line, code: 'draft_metadata', message: '投稿备注和工作版本号应保存在项目记录中。' })
      }
    }
    if (caption && !raw.includes('![') && /\.(?:png|jpe?g|svg|pdf|webp)\b/iu.test(raw)) {
      issues.push({ line, code: 'figure_placeholder', message: '图题只引用文件名。请定位可用图像并核对图注。' })
    }
    const plain = visible(raw).replace(/\|/gu, ' ').trim()
    if (plain) {
      chunks.push({ role, text: plain, category: caption ? 'caption' : table ? 'table' : 'prose' })
      if (!caption && !table) sections.at(-1)?.prose.push(plain)
    }
  }
  const selected = (scope: Scope, includeCaptions = false, includeTables = false) => chunks
    .filter(chunk => (scope === 'manuscript' ? chunk.role !== 'notes'
      : scope === 'body' ? !['title', 'abstract_zh', 'abstract_en', 'references', 'notes', 'supplement'].includes(chunk.role)
      : chunk.role === scope) && (chunk.category === 'prose' || (includeCaptions && chunk.category === 'caption') || (includeTables && chunk.category === 'table')))
    .map(chunk => chunk.text).join('\n')
  const limits = budgets.map(budget => {
    if ([budget.min, budget.max].some(limit => limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))) {
      throw new Error('篇幅上限、下限须为非负整数。')
    }
    if (budget.min !== undefined && budget.max !== undefined && budget.min > budget.max) throw new Error('字数范围的下限不能超过上限。')
    const measured = counts(selected(budget.scope, budget.includeCaptions, budget.includeTables))[budget.unit]
    return { ...budget, measured, status: budget.max !== undefined && measured > budget.max ? 'over'
      : budget.min !== undefined && measured < budget.min ? 'under' : 'within' }
  })
  return {
    method: '统计 Markdown 可见文本，标题和格式标记不计，保留行内编号。图注和表格可选。han 为汉字数量，words 为拉丁字母或数值词组，mixed 为两者之和。期刊版面与实际投稿文件需另核。',
    counts: Object.fromEntries(manuscriptScopes.map(scope => [scope, counts(selected(scope))])),
    optional: {
      captions: counts(chunks.filter(chunk => chunk.category === 'caption').map(chunk => chunk.text).join('\n')),
      tables: counts(chunks.filter(chunk => chunk.category === 'table').map(chunk => chunk.text).join('\n')),
    },
    budgets: limits,
    sections: sections.map(section => ({ title: section.title, line: section.line, role: section.role, counts: counts(section.prose.join('\n')) })),
    issues,
  }
}
