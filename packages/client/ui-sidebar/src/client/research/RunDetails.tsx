import { useState } from 'react'
import type { ResearchArtifact, ResearchInjected, ResearchProject, ResearchRun, ResearchStage, StageStatus } from './contracts.ts'
import { stageLabel, type ResearchTranslate } from './locales.ts'
import css from './ResearchPage.module.css'

const PHASES = [
  { key: 'phaseScope', start: 1, end: 2 },
  { key: 'phaseLiterature', start: 3, end: 6 },
  { key: 'phaseSynthesis', start: 7, end: 8 },
  { key: 'phaseDesign', start: 9, end: 11 },
  { key: 'phaseExperiment', start: 12, end: 13 },
  { key: 'phaseAnalysis', start: 14, end: 15 },
  { key: 'phaseWriting', start: 16, end: 19 },
  { key: 'phaseDelivery', start: 20, end: 23 },
] as const

export function AgentPanel({ project, t, recordUrl, artifactUrl }: {
  project?: ResearchProject
  t: ResearchTranslate
  recordUrl?: NonNullable<ResearchInjected['recordUrl']>
  artifactUrl: ResearchInjected['artifactUrl']
}) {
  const [expanded, setExpanded] = useState(false)
  const state = project?.agent
  const historical = project?.runs.flatMap(run => run.artifacts.map(artifact => ({ run, artifact }))) ?? []
  return <aside className={css.stages} aria-label={t('activityArea')} data-expanded={expanded || undefined}>
    <div className={css.columnHeader}>
      <h2>{t('activityArea')}</h2>
      {state?.active && <small>{t('running')}</small>}
      <button type="button" className={`${css.button} ${css.mobileStages}`} aria-expanded={expanded}
        onClick={() => { setExpanded(previous => !previous) }}>{t(expanded ? 'activityHide' : 'activityShow')}</button>
    </div>
    <div className={css.stageScroll}>
      {state?.pendingReview && project && <section className={css.stageCard}>
        <h3>{t('awaitingResearchDecision')}</h3>
        <p>{recordUrl ? <a href={recordUrl(project.id, state.pendingReview.id)} target="_blank" rel="noreferrer">{state.pendingReview.title}</a>
          : state.pendingReview.title}</p>
      </section>}
      {state?.activities.length ? <ol className={css.agentActivities} aria-live="polite">
        {state.activities.map(activity => <li key={activity.id}>
          <div><strong>{activity.title}</strong><span className={css.status} data-status={activity.state}>{t(activity.state)}</span></div>
          {activity.detail && <small>{activity.detail}</small>}
          {activity.artifacts.length > 0 && recordUrl && project && <ul className={css.artifacts}>
            {activity.artifacts.map(item => <li key={item.path}>
              <a href={recordUrl(project.id, item.path, 'file')} target="_blank" rel="noreferrer">{item.name}</a>
            </li>)}
          </ul>}
        </li>)}
      </ol> : <p className={css.quiet}>{t('activityEmpty')}</p>}
      <section className={css.stageCard}>
        <h3>{t('researchRecords')}</h3>
        {state?.records.length && project ? <ul className={css.artifacts}>{state.records.map(item => <li key={item.id}>
          {recordUrl ? <a href={recordUrl(project.id, item.id)} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
        </li>)}</ul> : <p>{t('researchRecordsEmpty')}</p>}
      </section>
      {historical.length > 0 && project && <details className={css.stageCard}>
        <summary>{t('formerResults')}</summary>
        <ul className={css.artifacts}>{historical.map(({ run, artifact }) => <li key={`${run.id}/${artifact.path}`}>
          <a href={artifactUrl(project.id, run.id, artifact.path, true)} download={artifact.name}>{artifact.name}</a>
        </li>)}</ul>
      </details>}
    </div>
  </aside>
}

interface StagePanelProps {
  projectId: string
  stages: readonly ResearchStage[]
  run?: ResearchRun | undefined
  artifactUrl: ResearchInjected['artifactUrl']
  t: ResearchTranslate
}

function statusFor(stage: ResearchStage, run: ResearchRun | undefined): StageStatus {
  const entry = run?.stages.find(item => item.id === stage.id)
  if (run?.stage === stage.id && (run.status === 'cancelled' || run.status === 'interrupted')) return run.status
  if (entry && entry.status !== 'pending') return entry.status
  if (run?.stage === stage.id) return run.status
  return stage.available ? 'pending' : 'blocked'
}

/** Displays upstream stage status and the records returned for each selected run. */
export function StagePanel({ projectId, stages, run, t, artifactUrl }: StagePanelProps) {
  const [chosen, chooseStage] = useState<{ active?: string | undefined; id: string }>()
  const [showMobile, setShowMobile] = useState(false)
  const selected = chosen?.active === run?.stage ? chosen?.id : undefined
  const stage = stages.find(item => item.id === selected) ?? stages.find(item => item.id === run?.stage) ?? stages[0]
  const completed = stages.filter(item => {
    const status = run?.stages.find(progress => progress.id === item.id)?.status
    return status === 'completed' || status === 'succeeded'
  }).length
  const progressLabel = t('stageProgress', { done: String(completed), total: String(stages.length) })
  const stageResult = run?.stages.find(item => item.id === stage?.id)
  const detailStatus = stage && statusFor(stage, run)
  const detailMessage = detailStatus === 'waiting_for_input' ? t('reviewInChat')
    : stageResult?.message || (stage?.id === run?.stage ? run?.message : '') || stage?.reason || ''
  const stageFolder = stage && `stage-${String(stage.number).padStart(2, '0')}/`
  const stageArtifacts = stageResult?.artifacts.length ? stageResult.artifacts
    : (run?.artifacts ?? []).filter(artifact => stageFolder && artifact.path.startsWith(stageFolder))
  const artifactLink = (artifact: ResearchArtifact) => artifactUrl(projectId, run?.id ?? '', artifact.path, true)

  return <aside className={css.stages} aria-label={t('stageArea')} data-expanded={showMobile || undefined}>
    <div className={css.columnHeader}>
      <h2>{t('stageArea')}</h2>
      <small>{t('stagesCount', { count: String(stages.length) })}</small>
      <button type="button" className={`${css.button} ${css.mobileStages}`} aria-expanded={showMobile}
        onClick={() => { setShowMobile(!showMobile) }}>{t(showMobile ? 'hideStages' : 'collapseStages')}</button>
    </div>
    <div className={css.stageScroll}>
      {stages.length > 0 && <div className={css.stageProgress}>
        <span>{progressLabel}</span>
        <progress value={completed} max={stages.length} aria-label={progressLabel} />
      </div>}
      {!run && <p className={css.quiet}>{t('noRun')}</p>}
      {stages.length === 0 ? <p className={css.quiet}>{t('noStages')}</p> : <div className={css.stageLayout}>
        <div className={css.stageList}>
          {PHASES.map(phase => {
            const steps = stages.filter(item => item.number >= phase.start && item.number <= phase.end)
            if (steps.length === 0) return null
            return <section className={css.stageGroup} key={phase.key}>
              <h3>{t(phase.key)}</h3>
              <ol>
                {steps.map(item => {
                  const status = statusFor(item, run)
                  return <li key={item.id}><button type="button" className={css.stageRow} aria-pressed={stage?.id === item.id}
                    onClick={() => { chooseStage({ active: run?.stage, id: item.id }) }}>
                    <span className={css.stageNumber} data-status={status}>{String(item.number).padStart(2, '0')}</span>
                    <span>{stageLabel(item.id, t)}</span>
                    <span className={css.status} data-status={status}>{t(status)}</span>
                  </button></li>
                })}
              </ol>
            </section>
          })}
        </div>
        {stage && <section className={css.stageCard} aria-label={t('stageInfo')}>
          <div className={css.stageHeading}>
            <h3>{stageLabel(stage.id, t)}</h3>
            {detailStatus && <span className={css.status} data-status={detailStatus}>{t(detailStatus)}</span>}
          </div>
          {detailMessage ? <p>{detailMessage}</p>
            : (detailStatus === 'pending' || detailStatus === 'blocked') && <p>{t(detailStatus === 'blocked' ? 'stageUnavailable' : 'stageIdle')}</p>}
          {stageArtifacts.length > 0 && <>
            <h4>{t('stageArtifacts')}</h4>
            <Artifacts items={stageArtifacts} t={t} link={artifactLink} />
          </>}
        </section>}
      </div>}
      {run && <section className={css.stageCard}>
        <h3>{t('runArtifacts')}</h3>
        {run.artifacts.length > 0 ? <Artifacts items={run.artifacts} t={t} link={artifactLink} /> : <p>{t('noArtifacts')}</p>}
      </section>}
    </div>
  </aside>
}

function Artifacts({ items, t, link }: {
  items: readonly ResearchArtifact[]
  t: ResearchTranslate
  link: (artifact: ResearchArtifact) => string
}) {
  return <ul className={css.artifacts}>{items.map(item => <li key={item.path}>
    <a href={link(item)} download={item.name} aria-label={t('download', { name: item.name })} title={item.path}>{item.name}</a>
  </li>)}</ul>
}

