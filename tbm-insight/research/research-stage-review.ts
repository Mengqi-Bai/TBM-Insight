import { JSON_SCHEMA, load } from 'js-yaml'

const STAGES: Record<string, [string, string, string[]]> = {
  TOPIC_INIT: ['研究选题', '请核对真实数据的字段与覆盖范围，以及研究目标是否可用这些数据验证。', ['dataset_profile.md', 'goal.md']],
  PROBLEM_DECOMPOSE: ['拆解问题', '请核对子问题的优先级，以及每个问题能否用现有数据或文献回答。', ['problem_tree.md']],
  LITERATURE_COLLECT: ['收集文献', '请确认候选覆盖了哪些研究方向，有无明显遗漏。确认后将进入文献筛选。', ['candidates.jsonl', 'search_meta.json']],
  LITERATURE_SCREEN: ['筛选文献', '请核对入选文献与课题的相关性。若覆盖不足，可要求扩大检索范围或返回检索策略。', ['shortlist.jsonl', 'screen_meta.json']],
  KNOWLEDGE_EXTRACT: ['提取知识', '请重点核对文献卡片中的数据、方法和结论是否与来源一致。', []],
  SYNTHESIS: ['证据综合', '请审阅文献之间的共识、分歧和研究缺口，确认哪些结论有证据支持。', ['synthesis.md']],
  HYPOTHESIS_GEN: ['形成假设', '请确认各项假设可以验证，并指出要优先检验的关系。', ['hypotheses.md']],
  EXPERIMENT_DESIGN: ['试验设计', '请确认数据、分组、对照方法和评价指标，尤其是训练与检验数据的分法。', ['exp_plan.yaml']],
  CODE_GENERATION: ['生成代码', '请先审阅实验说明，核对代码采用的输入、对照方法和输出指标。', ['experiment_spec.md', 'collider_plan.md']],
  RESOURCE_PLANNING: ['资源规划', '请核对实验顺序和估计用时，确认现有设备能完成计划。', ['schedule.json']],
  EXPERIMENT_RUN: ['执行试验', '请核对实际完成情况、输出指标和图表，再决定是否继续。', []],
  ITERATIVE_REFINE: ['迭代调整', '请比较调整前后的指标及保留的版本，确认改动有证据支持。', ['refinement_log.json']],
  RESULT_ANALYSIS: ['结果分析', '请核对结果解释、统计比较和不确定性，指出还需要验证的结论。', ['analysis.md']],
  RESEARCH_DECISION: ['研究决策', '请审阅继续研究或调整方向的依据，再决定是否按照建议推进。', ['decision.md']],
  PAPER_OUTLINE: ['论文提纲', '请确认各章节围绕同一研究问题，并安排相应的数据、图表和引文。', ['outline.md']],
  PAPER_DRAFT: ['论文初稿', '请通读正文，重点核对本文的方法、结果、图表和引文是否一致。', ['paper_draft.md']],
  PEER_REVIEW: ['同行评审', '请审阅模拟评审意见，明确哪些问题需要修改、补证据或说明理由。', ['reviews.md']],
  PAPER_REVISION: ['论文修订', '请核对修订稿是否逐项回应意见，检查数值和引文是否仍与证据一致。', ['paper_revised.md']],
  QUALITY_GATE: ['质量审查', '请审阅质量评分、仍需修改的事项和当前论文的证据完整性。', ['quality_report.json', 'fabrication_flags.json']],
  KNOWLEDGE_ARCHIVE: ['归档知识', '请核对研究过程、数据说明和复现实验所需材料是否齐全。', ['archive.md', 'bundle_index.json']],
  EXPORT_PUBLISH: ['导出成果', '请核对导出的论文、图表、参考文献及代码是否齐全。', ['paper_final.md']],
  CITATION_VERIFY: ['核对引文', '请查看核验结果，优先核对无法确认或被标为可疑的文献。', ['verification_report.json', 'references_verified.bib']],
}

const SOURCES: Record<string, string> = { arxiv: 'arXiv', openalex: 'OpenAlex', semantic_scholar: 'Semantic Scholar' }
const STATUS: Record<string, string> = {
  completed: '已完成', partial: '部分完成', failed: '失败', timeout: '超时', proceed: '建议继续',
  revision: '建议修订', revise: '建议修订', pivot: '建议调整方向', reject: '建议退回',
}
type Document = { name: string; kind: string; path: string }

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function plain(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim().slice(0, 260)
    .replace(/[\\`*_{}\[\]<>#!|~]/gu, '\\$&') : ''
}

function items(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    const fields = record(item)
    const label = plain(item) || plain(fields.name) || plain(fields.id) || plain(fields.metric) || plain(fields.description)
    return label ? [label] : []
  })
}

function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function json(text: string | undefined): unknown {
  try { return text ? JSON.parse(text) : undefined } catch { return undefined }
}

function yaml(text: string | undefined): Record<string, unknown> {
  try { return record(text ? load(text, { schema: JSON_SCHEMA }) : undefined) } catch { return {} }
}

const runningReport = (name: string): boolean => /^run-\d+\.json$/u.test(name)

/** Infer the stage for conversation history saved before stage IDs were included. */
export function stageOfReview(documents: readonly Document[]): string | undefined {
  if (['search_plan.yaml', 'sources.json', 'queries.json'].every(name => documents.some(file => file.name === name))) return 'SEARCH_STRATEGY'
  if (documents.some(file => file.name === 'verification_report.json')) return 'CITATION_VERIFY'
  if (documents.some(file => file.name === 'refinement_log.json')) return 'ITERATIVE_REFINE'
  if (documents.some(file => runningReport(file.name))) return 'EXPERIMENT_RUN'
  return Object.keys(STAGES).reverse().find(stage => documents.some(file => STAGES[stage]?.[2].includes(file.name)))
    ?? (documents.some(file => file.kind === 'markdown' && /(?:\/|^)cards\//u.test(file.path)) ? 'KNOWLEDGE_EXTRACT' : undefined)
}

export function reviewDataFiles(stage: string, documents: readonly Document[]): Document[] {
  const requested = stage === 'SEARCH_STRATEGY' ? ['search_plan.yaml', 'sources.json', 'queries.json']
    : STAGES[stage]?.[2].filter(name => !/\.(?:md|bib)$/u.test(name)) ?? []
  return documents.filter(file => requested.includes(file.name) || (stage === 'EXPERIMENT_RUN' && runningReport(file.name))).slice(0, 12)
}

function literature(files: ReadonlyMap<string, string>, screen: boolean): string[] {
  const data = files.get(screen ? 'shortlist.jsonl' : 'candidates.jsonl')
  const meta = record(json(files.get(screen ? 'screen_meta.json' : 'search_meta.json')))
  const rows = data?.split(/\r?\n/u).filter(line => line.trim()).map(line => record(json(line)))
    .filter(row => plain(row.title))
  const count = numeric(screen ? meta.shortlist_size : meta.total_candidates) ?? rows?.length
  const screened = numeric(meta.candidates_screened)
  const sources = new Map<string, number>()
  for (const row of rows ?? []) {
    const source = plain(row.source)
    if (source) sources.set(source, (sources.get(source) ?? 0) + 1)
  }
  const year = numeric(meta.year_min)
  const overview = [
    count !== undefined && (screen ? `本轮筛选后保留了 ${count} 篇入选文献。` : `本轮收集到 ${count} 篇候选文献。`),
    screened !== undefined && `本轮共审查了 ${screened} 篇候选。`,
    !screen && year !== undefined && `本轮检索采用的起始年份为 ${year} 年。`,
    !screen && sources.size > 0 && `候选分布为 ${[...sources].map(([source, size]) =>
      `${Object.hasOwn(SOURCES, source) ? SOURCES[source] : source} ${size} 篇`).join('、')}。`,
  ].filter((value): value is string => Boolean(value))
  const sample = (rows ?? []).slice(0, 5).map(row => {
    const year = numeric(row.year)
    const reason = screen ? plain(row.reason) || plain(row.rationale) : ''
    return `- ${plain(row.title)}${year !== undefined ? `（${year}）` : ''}${reason ? '。' + reason : ''}`
  })
  if (sample.length) overview.push('以下是部分文献题名，可展开原始清单核对出处。', sample.join('\n'))
  return overview
}

function experimentalDesign(plan: Record<string, unknown>): string[] {
  const question = plain(plan.question) || plain(plan.objective) || plain(plan.research_question) || plain(plan.hypothesis)
  const lines = [
    question && `试验将检验${question}。`,
    ...([
      ['数据或样本', plan.datasets ?? plan.dataset ?? plan.data],
      ['对照方法', plan.baselines ?? plan.baseline],
      ['试验条件', plan.conditions ?? plan.groups],
      ['评价指标', plan.metrics ?? plan.primary_metrics ?? plan.evaluation_metrics],
      ['消融对比', plan.ablations ?? plan.ablation],
    ] as const).flatMap(([label, values]) => {
      const valuesList = items(values).slice(0, 8)
      return valuesList.length ? [`${label}包括${valuesList.join('、')}。`] : []
    }),
  ].filter(Boolean)
  return lines
}

function schedule(row: Record<string, unknown>): string[] {
  const tasks = Array.isArray(row.tasks) ? row.tasks.map(record) : []
  if (!tasks.length) return []
  const list = tasks.slice(0, 6).map(task => {
    const name = plain(task.name) || plain(task.id) || '未命名任务'
    const minutes = numeric(task.estimated_minutes)
    const dependencies = items(task.depends_on)
    return `- ${name}${minutes === undefined ? '' : `，预计 ${minutes} 分钟`}${dependencies.length ? `，在${dependencies.join('、')}完成后执行` : ''}。`
  })
  return [`排程包含 ${tasks.length} 项任务，以下为主要安排。当前平台的隔离实验使用 CPU。`, list.join('\n')]
}

function experiments(files: ReadonlyMap<string, string>): string[] {
  const reports = [...files].filter(([name]) => runningReport(name)).map(([, text]) => record(json(text)))
  return reports.slice(0, 6).map(row => {
    const name = plain(row.run_id) || '本次试验'
    const status = plain(row.status)
    const metrics = Object.entries(record(row.metrics)).filter(([, value]) => numeric(value) !== undefined).slice(0, 8)
    const time = numeric(row.elapsed_sec)
    return `${name}${status ? '的状态为' + (Object.hasOwn(STATUS, status) ? STATUS[status] : status) : ''}${time === undefined ? '' : `，用时 ${Number(time.toFixed(1))} 秒`}。`
      + (metrics.length ? `输出指标为 ${metrics.map(([key, value]) => `${plain(key)} = ${numeric(value)}`).join('、')}。` : '')
  })
}

function statistics(fields: Record<string, unknown>, pairs: readonly [string, string][]): string[] {
  return pairs.flatMap(([key, name]) => {
    const value = numeric(fields[key])
    return value === undefined ? [] : [`${name}为 ${value}。`]
  })
}

function findings(stage: string, documents: readonly Document[], files: ReadonlyMap<string, string>): string[] {
  switch (stage) {
    case 'LITERATURE_COLLECT': return literature(files, false)
    case 'LITERATURE_SCREEN': return literature(files, true)
    case 'EXPERIMENT_DESIGN': return experimentalDesign(yaml(files.get('exp_plan.yaml')))
    case 'RESOURCE_PLANNING': return schedule(record(json(files.get('schedule.json'))))
    case 'EXPERIMENT_RUN': return experiments(files)
    case 'ITERATIVE_REFINE': {
      const log = record(json(files.get('refinement_log.json')))
      const rounds = Array.isArray(log.iterations) ? log.iterations.length : numeric(log.iterations_completed)
      const key = plain(log.metric_key)
      const value = numeric(log.best_metric)
      return [rounds !== undefined && `报告记录了 ${rounds} 次迭代。`,
        value !== undefined && `记录的最佳${key || '指标'}值为 ${value}。`, log.skipped === true && '报告显示本轮未执行额外迭代。']
        .filter((item): item is string => Boolean(item))
    }
    case 'QUALITY_GATE': {
      const report = record(json(files.get('quality_report.json')))
      const issues = items(report.weaknesses ?? report.issues).slice(0, 5)
      const verdict = plain(report.verdict)
      return [...statistics(report, [['score_1_to_10', '质量评分（满分 10）']]),
        ...(verdict && Object.hasOwn(STATUS, verdict) ? [`报告${STATUS[verdict]}。`] : []),
        ...(issues.length ? ['报告列出了以下待核对事项。', issues.map(item => '- ' + item).join('\n')] : [])]
    }
    case 'CITATION_VERIFY': {
      const report = record(json(files.get('verification_report.json')))
      return statistics({ ...report, ...record(report.summary) }, [
        ['total', '核验范围内的引文数'], ['verified', '核验通过的引文数'], ['suspicious', '存疑的引文数'],
        ['hallucinated', '报告标记为疑似虚构的引文数'], ['skipped', '本轮跳过的引文数'], ['unverified', '暂未核实的引文数'],
      ])
    }
    case 'KNOWLEDGE_EXTRACT':
      return [`下面提供 ${documents.filter(file => file.kind === 'markdown').length} 份可审阅的文献卡片。`]
    case 'CODE_GENERATION':
      return [`本阶段整理了 ${documents.filter(file => file.name.endsWith('.py')).length} 份 Python 源文件，实验说明可在下方审阅。`]
    case 'KNOWLEDGE_ARCHIVE':
    case 'EXPORT_PUBLISH':
      return [`本阶段提供 ${documents.length} 项可查阅成果。`]
    default:
      return []
  }
}

/** Supplement the stage's full documents with a readable, data-grounded overview. */
export function stageReview(stage: string, documents: readonly Document[], files: ReadonlyMap<string, string>): string | undefined {
  const descriptor = Object.hasOwn(STAGES, stage) ? STAGES[stage] : undefined
  if (!descriptor) return undefined
  const [title, action] = descriptor
  const results = findings(stage, documents, files)
  const prose = documents.some(file => file.kind === 'markdown') ? '正文已附在下方，可直接核对。' : ''
  return [`## ${title}·审阅`, ...results, action, prose].filter(Boolean).join('\n\n')
}
