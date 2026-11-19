const STRATEGIES: Record<string, string> = {
  core_topic: '核心研究问题',
  keyword_core: '核心关键词检索',
  related_methods: '相关研究方法',
  benchmarks_datasets: '评测基准与数据集',
  theoretical_foundations: '理论基础',
  applications_interpretability: '工程应用与结果解释',
  backward_forward_citation: '追溯参考文献和后续引用',
}

const LANGUAGES: Record<string, string> = { zh: '中文', chinese: '中文', en: '英文', english: '英文' }
const FORMATS: Record<string, string> = { peer_reviewed_or_core_journal: '同行评议论文或核心期刊论文' }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function plain(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
}

function list(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).map(plain).filter(Boolean)
}

function literal(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#!|~]/gu, '\\$&')
}

function names(values: string[]): string {
  return values.map(literal).join('、')
}

function strategies(plan: Record<string, unknown>): string[] {
  const phases = plan.search_strategies ?? plan.search_phases ?? plan.phases
  const entries = Array.isArray(phases)
    ? phases.map(value => {
      const phase = record(value)
      return { name: plain(phase.name) || plain(phase.title), description: plain(phase.description) }
    })
    : Object.keys(record(plan.query_strategies)).map(name => ({ name, description: '' }))
  return entries.filter(entry => entry.name).slice(0, 20).map(({ name, description }) => {
    const title = Object.hasOwn(STRATEGIES, name) ? STRATEGIES[name]! : name.replaceAll('_', ' ')
    return '- ' + literal(title) + (description ? '。' + literal(description) : '')
  })
}

/** Turn the stage's actual artifacts into a review for the research conversation. */
export function searchStrategyReview(rawPlan: unknown, rawSources: unknown, rawQueries: unknown, localMaterials: boolean): string | undefined {
  const plan = record(rawPlan)
  const filters = record(plan.filters)
  const queryInfo = record(rawQueries)
  const queries = list(queryInfo.queries)
  if (!queries.length) return undefined

  const topic = plain(plan.topic)
  const objective = plain(plan.objective)
  const directions = strategies(plan)
  const sources = record(rawSources).sources
  const plannedSources = Array.isArray(sources)
    ? [...new Set(sources.map(value => plain(record(value).name) || plain(record(value).id)).filter(Boolean))]
    : []
  const languages = list(filters.language ?? plan.language).map(value => {
    const id = value.toLowerCase()
    return Object.hasOwn(LANGUAGES, id) ? LANGUAGES[id]! : value
  })
  const publicationTypes = list(filters.publication_type).map(value =>
    Object.hasOwn(FORMATS, value) ? FORMATS[value]! : value.replaceAll('_', ' '))
  const dateWindow = plain(plan.date_window)
  const criteria = [
    dateWindow && `建议覆盖 ${literal(dateWindow)} 年的文献。`,
    languages.length > 0 && `建议纳入${names(languages)}文献。`,
    publicationTypes.length > 0 && `优先查看${names(publicationTypes)}。`,
    !publicationTypes.length && filters.peer_review_preferred === true && '优先查看经过同行评议的论文。',
    filters.include_preprints === true && '将预印本纳入候选。',
    filters.include_preprints === false && '筛选时排除预印本。',
    ...list(plan.inclusion_criteria ?? filters.inclusion_criteria).map(value => `纳入条件为${literal(value)}。`),
    ...list(plan.exclusion_criteria ?? filters.exclusion_criteria).map(value => `排除条件为${literal(value)}。`),
  ].filter((line): line is string => Boolean(line))
  const firstYear = typeof queryInfo.year_min === 'number' ? queryInfo.year_min : Number(plain(queryInfo.year_min))
  const validYear = Number.isInteger(firstYear) && firstYear >= 1000 && firstYear <= 9999
  const preview = queries.slice(0, 8)
  return [
    '## 文献检索策略',
    topic ? `本轮围绕「${literal(topic)}」收集文献。` : '本轮将围绕已确认的研究问题收集文献。',
    objective && literal(objective),
    '### 查什么',
    directions.join('\n'),
    `已整理 ${queries.length} 条基础检索式${queryInfo.model_queries_extracted === false ? '，由课题关键词自动生成' : ''}。`,
    preview.map(query => `- ${literal(query)}`).join('\n'),
    queries.length > preview.length && `其余 ${queries.length - preview.length} 条可展开 queries.json 查看。`,
    '### 去哪里查',
    '自动收集文献使用 OpenAlex、Semantic Scholar 和 arXiv。',
    plannedSources.length > 0 && `方案列出的来源包括${names(plannedSources)}。`,
    '### 检索范围与筛选',
    validYear && `自动检索从 ${firstYear} 年起查找文献。`,
    localMaterials && '本次研究引用了本机资料，在线检索会使用公开的工程关键词。',
    criteria.length > 0 && '方案建议在审阅文献时采用以下条件。',
    criteria.map(line => `- ${line}`).join('\n'),
    '请确认检索方向和范围。需要调整时，可直接在对话里补充要求。',
  ].filter(Boolean).join('\n\n')
}
