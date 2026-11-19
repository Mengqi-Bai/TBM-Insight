import type { PropsLocale } from '@tbm-insight/client-ui-slots'

export const NS = 'tbmResearch'

const stageNames = {
  COMPARE_WEEKS: '对比两周数据',
  TOPIC_INIT: '研究选题', PROBLEM_DECOMPOSE: '拆解问题', SEARCH_STRATEGY: '检索策略',
  LITERATURE_COLLECT: '收集文献', LITERATURE_SCREEN: '筛选文献', KNOWLEDGE_EXTRACT: '提取知识',
  SYNTHESIS: '证据综合', HYPOTHESIS_GEN: '形成假设', EXPERIMENT_DESIGN: '试验设计',
  CODE_GENERATION: '生成代码', RESOURCE_PLANNING: '资源规划', EXPERIMENT_RUN: '执行试验',
  ITERATIVE_REFINE: '迭代调整', RESULT_ANALYSIS: '结果分析', RESEARCH_DECISION: '研究决策',
  PAPER_OUTLINE: '论文提纲', PAPER_DRAFT: '论文初稿', PEER_REVIEW: '同行评审',
  PAPER_REVISION: '论文修订', QUALITY_GATE: '质量审查', KNOWLEDGE_ARCHIVE: '归档知识',
  EXPORT_PUBLISH: '导出成果', CITATION_VERIFY: '核对引文',
} as const

export const zh = {
  ...stageNames,
  research: '科研平台', projects: '项目', newProject: '新建项目', projectName: '项目名称',
  create: '创建', cancelForm: '取消',
  projectDirectory: '保存位置', defaultDirectory: '默认科研目录', browseDirectory: '选择文件夹', directoryError: '无法打开文件夹选择器。可以直接填写保存位置。',
  noProjects: '新建项目后，发送一句话开始研究。', chooseProject: '选择一个项目查看研究进展。',
  loading: '正在读取项目…', retry: '重试', requestError: '操作失败，请重试', refreshError: '状态暂未更新，将自动重试',
  deleteProject: '删除项目', deleteHeading: '删除「{name}」？', deleteConfirm: '删除项目会同时移除对话和运行成果。',
  keepProject: '保留项目', confirmDelete: '确认删除', working: '正在处理…',
  conversation: '项目对话', you: '你', assistant: '科研助手', promptLabel: '研究任务',
  promptPlaceholder: '输入研究问题',
  emptyTitle: '从一个研究问题开始',
  emptyConversation: '描述研究问题、希望核对的资料和期望成果，即可开始。',
  send: '发送任务', sendFeedback: '发送修改意见', feedbackPlaceholder: '输入修改意见，或指定要回到的阶段',
  runningFeedbackPlaceholder: '可输入要返回或重做的阶段',
  assistantWorking: '科研助手正在处理…', stopWaiting: '停止等待', responseStopped: '已停止等待，消息已放回输入框。',
  addAttachment: '添加文件或图片，也可拖入对话框', uploading: '正在上传附件…',
  attachmentCount: '一条消息最多添加 8 个附件。', removeAttachment: '移除 {name}',
  confirmStage: '确认并继续', finishReview: '确认完成', modelUnset: '未选择模型', reviewArtifacts: '本阶段成果',
  reviewInChat: '请在对话中审阅成果、提出修改或确认继续。',
  loadingDocument: '正在读取成果…', documentError: '无法读取全文，可以下载文件查看。',
  phaseScope: '研究范围', phaseLiterature: '文献发现', phaseSynthesis: '知识综合', phaseDesign: '试验设计',
  phaseExperiment: '试验执行', phaseAnalysis: '分析与决策', phaseWriting: '论文写作', phaseDelivery: '成果定稿',
  stageProgress: '已完成 {done} / {total} 个阶段',
  stageArea: '研究阶段',  stagesCount: '共 {count} 个阶段', noStages: '服务暂未返回阶段目录。',
  stageInfo: '阶段详情', stageIdle: '等待本次任务推进到此阶段。', stageUnavailable: '当前运行条件下暂未开放。',
  queued: '排队中', running: '运行中', waiting_for_input: '等待处理', succeeded: '已完成', completed: '已完成',
  failed: '失败', cancelled: '已暂停', interrupted: '已中断', pending: '待准备', blocked: '受阻', skipped: '已跳过',
  stopRun: '暂停任务', resumeRun: '恢复任务',
  runArtifacts: '本次运行产物', stageArtifacts: '阶段产物', noArtifacts: '暂无可下载的产物。',
  activityArea: '研究活动', activityEmpty: '助手调用工具后，操作与结果会显示在这里。',
  researchRecords: '项目成果', researchRecordsEmpty: '新保存的研究记录和文档会显示在这里。',
  formerResults: '原流程成果', agentPlaceholder: '输入研究问题、数据路径或修改意见',
  activityShow: '显示活动', activityHide: '收起活动',
  awaitingResearchDecision: '待你决定',
  approveResearchDecision: '我确认「{name}」（记录 {id}），请按这个方案继续。',
  download: '下载 {name}', collapseStages: '显示阶段', hideStages: '收起阶段', noRun: '发送任务后，阶段状态会在这里更新。',
} as const

export type ResearchKey = keyof typeof zh
export type ResearchTranslate = PropsLocale<'tbmResearch'>['t']

/** Localize a known stage while preserving the identifier of a newly introduced stage. */
export function stageLabel(stage: string, t: ResearchTranslate): string {
  return Object.hasOwn(stageNames, stage) ? t(stage as keyof typeof stageNames) : stage
}

declare module '@tbm-insight/client-ui-slots' {
  interface LocaleNamespaceMap {
    tbmResearch: ResearchKey
  }
}

