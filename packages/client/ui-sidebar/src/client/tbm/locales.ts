export const NS = 'tbmPanels'

export const zh = {
  progress: '施工进度', conditions: '掘进工况', cutters: '设备与换刀', evidence: '规范与案例',
  historical: '引松 CREC188 · 历史记录', knowledge_index: '本地规范与案例库',
  indexing: '首次准备本周数据，已就绪的日期会先显示。',
  working: '正在读取工程数据…', refreshing: '正在更新，当前显示上次结果',
  failed: '读取数据失败', refreshFailed: '更新失败，当前显示上次结果', retry: '重试',
  empty: '当前查询没有可展示的数据', noValues: '未提供', datesLoading: '正在读取可用选项…', noDates: '暂无有数据的现场日期',
  unavailableDate: '{date} 暂无 PLC 归档，已选中可用日期',
  date: '现场日期',
  field: '参数', coverage: '记录覆盖', observations: 'PLC 记录数',
  chainageAdvance: '周累计掘进增量', unknownUnit: '桩号变化量，单位待确认',
  weeklyStops: '周累计估算停机', classifiedOnly: '仅统计可判定区间', days: '天', minutes: '分', hours: '小时', seconds: '秒',
  advanceChart: '本周掘进变化', weeklyBars: '每日掘进增量', cumulativeAdvance: '累计掘进增量', daily: '每日', cumulative: '累计',
  timeMix: '本周掘进用时占比', timeBasis: '分母为有归档各日从零点到最后观测的总时长，未覆盖区段计为未知。',
  excavating: '掘进', stopped: '估算停机', other: '其他已判定', undetermined: '未知',
  dailyMix: '每日停机与工况分布', dailyMixNote: '柱顶为估算停机时长，点选日期查看明细', hourValue: '{value} 小时',
  dayDetail: '当天明细', openDay: '打开所选日明细', closeDetail: '收起明细', readingDay: '正在读取当天明细…',
  stopSegments: '停机区间', gaps: '未计入的覆盖缺口',
  showStops: '再显示 {count} 段', listedGaps: '列出最早 {count} 段，共 {total} 段。',
  noStops: '所选日没有可展示的停机区间。', noGaps: '所选日没有报告覆盖缺口。',
  cutoff: '统计截止', duration: '持续时长', dateRange: '{start} 至 {end}', dateRangeExclusive: '{start} 至 {end}（结束日不含）',
  openConditions: '查看此段工况', evidenceLines: '来源行号', archive: '来源归档',
  rowRange: '第 {start}–{end} 行', openDraft: '带入会话',
  draft: '【TBM 面板上下文】\n数据模式：历史\n数据来源：{source}\n请基于以下面板记录继续分析。\n{facts}',
  trend: '关键 PLC 参数趋势', conditionsLimits: '设备限值事件', noLimits: '当前时间窗未返回可展示的限值事件。',
  running: '可判定运行时长', runningBasis: '根据活动 PLC 信号估算',
  trendNote: '时间轴为现场时刻。缩放使用已保留的采样点；相邻采样点之间可估算，断线区间显示缺测。原始测点单位待确认。',
  inspectTime: '查看时刻', valueAxis: '数值刻度', cursorValue: '{time} · {value} · {quality}',
  sampleObserved: '实测', sampleEstimated: '估算', sampleMissing: '缺测',
  wheelZoom: '在曲线上滚动鼠标滚轮缩放', trendZoomReset: '重置',
  zoomView: '显示 {start} 至 {end}',
  limitCounts: '达到预警设定 {warning} 段 · 达到报警设定 {alarm} 段', warning: '达到预警设定', alarm: '达到报警设定',
  openLimits: '查看参数越限', metricDetails: '参数统计明细',
  reason: '原因', threshold: '设定值', measured: '观测值', events: '事件', average: '平均', minimum: '最小', maximum: '最大',
  downloadReport: '下载明细报告', records: '原始记录', treatments: '刀位处理', cutterPositions: '涉及刀位', times: '次', recordsUnit: '条',
  position: '刀位', positionName: '{position} 号刀位', showAllPositions: '显示全部 {count} 个刀位', showTopPositions: '仅显示前六',
  eventsChart: '每日换刀处理次数', cutterDaysNote: '按刀位处理计数，空柱表示无台账记录', noLedgerDate: '无台账记录', positionsChart: '刀位处理次数排行', reasons: '更换原因构成', reasonBasis: '按刀位处理次数统计',
  details: '查看明细', cutterDetails: '刀位处理记录', allTreatments: '全部刀位处理', clearFilters: '清除筛选', moreRecords: '再显示 {count} 条',
  ledgerCutoff: '台账截止', missingDates: '日期无法归属的记录',
  search: '检索', searchPrompt: '例如：岩石 TBM 刀具安装螺栓有什么要求？', query: '检索问题',
  evidencePlaceholder: '输入工程问题或选择一条示例问题开始检索。', evidenceMode: '检索范围', region: '地域', anyRegion: '不限',
  auto: '自动识别', standard: '规范', case: '案例', both: '规范与案例',
  queryBolts: '岩石 TBM 刀具安装螺栓有什么要求？', queryCoal: '煤矿 TBM 遇到地质异常区如何处理？',
  queryStuck: '有相似的断层卡机处置案例吗？',
  standards: '规范条款', cases: '本地施工案例', noEvidence: '未检索到直接支持当前问题的证据。',
  caseLead: '本地案例库记录', candidate: '候选证据', sourceFile: '打开原始文件', sourceLine: '原文第 {line} 行',
  standardLibrary: '规范 PDF 目录', openPdf: '打开规范 PDF', openCase: '查看案例详情', caseEvent: '施工事件 {number}',
  librarySearch: '查找规范', librarySearchHint: '输入标准编号或名称', libraryCategory: '资料分类', allLibraryCategories: '全部分类',
  libraryCount: '共 {total} 份 · 匹配 {found} 份', noLibraryMatches: '没有匹配的规范，请更换编号、名称或分类。',
  emptyLibrary: '暂无可打开的 PDF 原件。', morePdfs: '显示更多规范', returnLibrary: '返回规范目录', pdfUnavailable: '暂无对应版本的 PDF 原件',
  pointer: '事件定位', applicability: '适用范围与核对', sourceNotes: '证据说明', quote: '展开完整引用',
} as const

export type TbmKey = keyof typeof zh

declare module '@tbm-insight/client-ui-slots' {
  interface LocaleNamespaceMap {
    tbmPanels: TbmKey
  }
}

