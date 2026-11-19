import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { IconPauseOutlineRegular, IconPlayOutlineRegular, IconPlusOutlineRegular, IconSparkleRegular, IconTrashOutlineRegular, MarkdownText, Modal, UserMessageBubble } from '@tbm-insight/client-ui-primitives'
import type { InjectFace, PropsLocale } from '@tbm-insight/client-ui-slots'
import { isActive, type ResearchArtifact, type ResearchCatalog, type ResearchCommand, type ResearchInjected, type ResearchProject, type ResearchUpload } from './contracts.ts'
import { stageLabel, type ResearchTranslate } from './locales.ts'
import { AgentPanel, StagePanel } from './RunDetails.tsx'
import css from './ResearchPage.module.css'

type ResearchPageProps = InjectFace<ResearchInjected> & PropsLocale<'tbmResearch'>
const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }
const metadataFiles = new Set(['decision.json', 'stage_health.json', 'hardware_profile.json', 'hitl_guidance.md'])

function errorMessage(error: unknown, t: ResearchTranslate): string {
  return error instanceof Error && error.message ? error.message : t('requestError')
}

function displayTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

function order(projects: readonly ResearchProject[]): ResearchProject[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** Project conversations and the research execution workspace. */
export function ResearchPage({ t, catalog, request, artifactUrl, pickDirectory, upload, uploadUrl, recordUrl }: ResearchPageProps) {
  const [snapshot, setSnapshot] = useState<ResearchCatalog>()
  const [selected, select] = useState('')
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<ResearchProject>()
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revision, retry] = useState(0)
  const [catalogError, setCatalogError] = useState('')
  const [actionError, setActionError] = useState('')
  const locked = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void catalog(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setSnapshot({ ...value, projects: order(value.projects) })
      select(previous => value.projects.some(project => project.id === previous) ? previous : order(value.projects)[0]?.id ?? '')
    }, error => {
      if (!controller.signal.aborted) setCatalogError(errorMessage(error, t))
    })
    return () => { controller.abort() }
  }, [catalog, revision, t])

  const updateProject = useCallback((project: ResearchProject) => {
    setSnapshot(previous => previous?.projects.some(item => item.id === project.id)
      ? { ...previous, projects: order([...previous.projects.filter(item => item.id !== project.id), project]) }
      : previous)
  }, [])

  const perform = async (command: ResearchCommand, accepted: (value: ResearchProject | undefined) => void) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setActionError('')
    try { accepted(await request(command)) } catch (error) { setActionError(errorMessage(error, t)) }
    finally { locked.current = false; setBusy(false) }
  }

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) return
    void perform({ action: 'create', name: name.trim(), ...(directory.trim() ? { directory: directory.trim() } : {}) }, value => {
      if (!value) return
      setSnapshot(previous => previous ? { ...previous, projects: order([...previous.projects, value]) } : previous)
      select(value.id)
      setCreating(false)
      setName('')
      setDirectory('')
    })
  }

  const remove = () => {
    if (!removing) return
    const projectId = removing.id
    void perform({ action: 'delete', projectId }, () => {
      const remaining = snapshot?.projects.filter(project => project.id !== projectId) ?? []
      setSnapshot(previous => previous ? { ...previous, projects: previous.projects.filter(project => project.id !== projectId) } : previous)
      select(previous => previous === projectId ? remaining[0]?.id ?? '' : previous)
      setRemoving(undefined)
    })
  }

  const selectFolder = () => {
    if (!pickDirectory || picking) return
    setActionError('')
    setPicking(true)
    void pickDirectory().then(path => { if (path) setDirectory(path) }, () => {
      setActionError(t('directoryError'))
    }).finally(() => { setPicking(false) })
  }

  const project = snapshot?.projects.find(item => item.id === selected)
  return <main className={css.page} data-tbm-panel="research">
    <header className={css.pageHeader}>
      <h1>{t('research')}</h1>
    </header>
    <div className={css.workspace}>
      <nav className={css.projects} aria-label={t('projects')}>
        <div className={css.columnHeader}>
          <h2>{t('projects')}</h2>
          <button className={css.button} type="button" disabled={!snapshot} onClick={() => { setCreating(true); setActionError('') }}>
            <IconPlusOutlineRegular size={15} />{t('newProject')}
          </button>
        </div>
        {!snapshot && !catalogError && <p className={css.quiet} role="status">{t('loading')}</p>}
        {catalogError && <div className={css.notice} role="alert">
          <p>{catalogError}</p>
          <button className={css.button} type="button" onClick={() => { setCatalogError(''); retry(value => value + 1) }}>{t('retry')}</button>
        </div>}
        {snapshot?.projects.length === 0 && <p className={css.quiet}>{t('noProjects')}</p>}
        <ul className={css.projectList}>
          {snapshot?.projects.map(item => <li key={item.id}>
            <button type="button" className={css.projectRow} aria-current={item.id === selected ? 'true' : undefined}
              onClick={() => { select(item.id) }}>
              <span>{item.name}</span>
              <small>{displayTime(item.updatedAt)}</small>
            </button>
          </li>)}
        </ul>
        {project && <div className={css.projectFooter}>
          <button className={css.button} type="button" disabled={snapshot?.agentDriven ? project.agent?.active : project.runs.some(isActive)}
            onClick={() => { setRemoving(project); setActionError('') }}>
            <IconTrashOutlineRegular size={15} />{t('deleteProject')}
          </button>
        </div>}
      </nav>
      {project && snapshot
        ? <ProjectWorkspace key={project.id} initial={project} catalog={snapshot} request={request} artifactUrl={artifactUrl} update={updateProject} t={t}
            {...(upload ? { upload } : {})} {...(uploadUrl ? { uploadUrl } : {})} {...(recordUrl ? { recordUrl } : {})} />
        : <><section className={css.blank}><p>{t(snapshot?.projects.length === 0 ? 'noProjects' : 'chooseProject')}</p></section>
          {snapshot?.agentDriven ? <AgentPanel t={t} artifactUrl={artifactUrl} />
            : <StagePanel stages={snapshot?.stages ?? []} projectId="" t={t} artifactUrl={artifactUrl} />}</>}
    </div>
    {creating && <Modal open title={t('newProject')} closeLabel={t('cancelForm')} onClose={() => { if (!busy && !picking) setCreating(false) }}>
      <form className={css.dialogForm} onSubmit={create}>
        <label><span>{t('projectName')}</span>
          <input data-modal-autofocus required maxLength={100} value={name}
            disabled={busy} onChange={event => { setName(event.currentTarget.value) }} />
        </label>
        <div className={css.folderField}>
          <label><span>{t('projectDirectory')}</span><input value={directory} disabled={busy} maxLength={1200}
            placeholder={t('defaultDirectory')} onChange={event => { setDirectory(event.currentTarget.value) }} /></label>
          {pickDirectory && <button type="button" className={css.button} disabled={busy || picking}
            onClick={selectFolder}>{t('browseDirectory')}</button>}
        </div>
        {actionError && <p className={css.notice} role="alert">{actionError}</p>}
        <div className={css.actions}>
          <button type="button" className={css.button} disabled={busy || picking} onClick={() => { setCreating(false) }}>{t('cancelForm')}</button>
          <button type="submit" className={css.primary} disabled={busy || picking || !name.trim()}>{t(busy ? 'working' : 'create')}</button>
        </div>
      </form>
    </Modal>}
    {removing && <Modal open tone="warning" title={t('deleteHeading', { name: removing.name })} closeLabel={t('keepProject')}
      onClose={() => { if (!busy) setRemoving(undefined) }}>
      <p>{t('deleteConfirm')}</p>
      {actionError && <p className={css.notice} role="alert">{actionError}</p>}
      <div className={css.actions}>
        <button data-modal-autofocus type="button" className={css.button} disabled={busy} onClick={() => { setRemoving(undefined) }}>{t('keepProject')}</button>
        <button type="button" className={css.danger} disabled={busy} onClick={remove}>{t(busy ? 'working' : 'confirmDelete')}</button>
      </div>
    </Modal>}
  </main>
}

interface ProjectProps extends Pick<ResearchPageProps, 't' | 'request' | 'artifactUrl' | 'upload' | 'uploadUrl' | 'recordUrl'> {
  initial: ResearchProject
  catalog: ResearchCatalog
  update: (project: ResearchProject) => void
}

function ProjectWorkspace({ initial, catalog, request, artifactUrl, update, t, upload, uploadUrl, recordUrl }: ProjectProps) {
  const [project, setProject] = useState(initial)
  const [prompt, setPrompt] = useState('')
  const [pending, setPending] = useState<ResearchCommand['action']>()
  const [sent, setSent] = useState<{ message: string; uploads: ResearchUpload[] }>()
  const [draftUploads, setDraftUploads] = useState<ResearchUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [failure, setFailure] = useState('')
  const [refreshFailed, setRefreshFailed] = useState(false)
  const lock = useRef(false)
  const uploadLock = useRef(false)
  const sendController = useRef<AbortController>()
  const fileInput = useRef<HTMLInputElement>(null)
  const refresh = useRef<AbortController | null>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const composerInput = useRef<HTMLTextAreaElement>(null)
  const followEnd = useRef(true)
  const agentDriven = catalog.agentDriven === true
  const active = agentDriven ? project.agent?.active === true : project.runs.some(isActive)
  const run = project.runs[0]
  const reviewing = !agentDriven && run?.status === 'waiting_for_input' && run.gate !== undefined
  const processing = !agentDriven && (run?.status === 'queued' || run?.status === 'running')
  const resumable = !agentDriven && run && ['failed', 'cancelled', 'interrupted'].includes(run.status)
  const acceptingFeedback = reviewing || Boolean(resumable) || processing
  const reviewedStage = reviewing ? catalog.stages.find(stage => stage.id === run.gate?.stage) : undefined
  const stagePrefix = reviewedStage ? `stage-${String(reviewedStage.number).padStart(2, '0')}/` : undefined
  const reviewFiles = stagePrefix ? run?.artifacts.filter(artifact => artifact.path.startsWith(stagePrefix) && !metadataFiles.has(artifact.name)) ?? [] : []
  const latestMessage = project.messages.at(-1)
  const projectId = initial.id
  const messageCount = project.messages.length + (sent ? 1 : 0)

  useEffect(() => {
    if (pending !== undefined) return
    const controller = new AbortController()
    refresh.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const get = async () => {
      try {
        const value = await request({ action: 'get', projectId }, controller.signal)
        if (controller.signal.aborted || !value) return
        setProject(value)
        update(value)
        setRefreshFailed(false)
        if (agentDriven ? value.agent?.active : value.runs.some(isActive)) timer = setTimeout(() => { void get() }, 1300)
      } catch (_error) {
        if (controller.signal.aborted) return
        setRefreshFailed(true)
        timer = setTimeout(() => { void get() }, 4000)
      }
    }
    void get()
    return () => { controller.abort(); clearTimeout(timer); refresh.current = null }
  }, [agentDriven, pending, projectId, request, update])

  useEffect(() => {
    const element = conversation.current
    if (element && followEnd.current) element.scrollTop = element.scrollHeight
  }, [messageCount])

  const mutate = async (command: ResearchCommand, outgoing?: { message: string; uploads: ResearchUpload[] }) => {
    if (lock.current) return
    lock.current = true
    refresh.current?.abort()
    setPending(command.action)
    setFailure('')
    const controller = outgoing ? new AbortController() : undefined
    if (outgoing) {
      sendController.current = controller
      followEnd.current = true
      setSent(outgoing)
      setPrompt('')
      setDraftUploads([])
    }
    try {
      const value = await request(command, controller?.signal)
      if (!value) throw new Error()
      setProject(value)
      update(value)
    } catch (error) {
      if (outgoing) {
        setPrompt(current => current ? [outgoing.message, current].filter(Boolean).join('\n') : outgoing.message)
        setDraftUploads(outgoing.uploads)
      }
      setFailure(controller?.signal.aborted ? t('responseStopped') : errorMessage(error, t))
    } finally {
      if (outgoing) {
        sendController.current = undefined
        setSent(undefined)
      }
      lock.current = false
      setPending(undefined)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = prompt.trim()
    if ((!message && !draftUploads.length) || pending !== undefined || uploadLock.current) return
    const attachments = draftUploads.length ? { uploads: draftUploads.map(file => file.id) } : {}
    const outgoing = { message, uploads: draftUploads }
    if (reviewing) void mutate({ action: 'respond', projectId, runId: run.id, decision: 'guide', message, ...attachments }, outgoing)
    else void mutate({ action: 'submit', projectId, message, ...attachments }, outgoing)
  }

  const addFiles = async (files: File[]) => {
    if (!upload || uploadLock.current || lock.current || !files.length) return
    const room = 8 - draftUploads.length
    if (!agentDriven && files.length > room) {
      setFailure(t('attachmentCount'))
      return
    }
    uploadLock.current = true
    setUploading(true)
    setFailure('')
    const errors = []
    try {
      for (const file of files) {
        try {
          const result = await upload(projectId, file)
          setDraftUploads(previous => [...previous, result])
        } catch (error) { errors.push(file.name + ' · ' + errorMessage(error, t)) }
      }
      if (errors.length) setFailure(errors.join('\n'))
    } finally {
      uploadLock.current = false
      setUploading(false)
    }
  }

  const filesInBubble = (items: ResearchUpload[] | undefined) => items?.length ? <div className={css.messageUploads}>
    {items.map(item => uploadUrl ? <a className={css.attachment} key={item.id} href={uploadUrl(projectId, item.id, true)} download={item.name}>
      {/^(png|jpe?g|webp)$/u.test(item.kind) && <img src={uploadUrl(projectId, item.id)} alt="" loading="lazy" />}
      <span>{item.name}</span>
    </a> : <span key={item.id}>{item.name}</span>)}
  </div> : null

  return <>
    <section className={css.chat} aria-label={t('conversation')}>
      <header className={css.columnHeader}><h2 title={project.directory}>{project.name}</h2></header>
      <div className={css.thread} ref={conversation} onScroll={event => {
        const node = event.currentTarget
        followEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 56
      }}>
        {messageCount === 0 && <div className={css.chatEmpty}>
          <span className={css.chatEmblem} aria-hidden="true"><IconSparkleRegular size={29} /></span>
          <h3>{t('emptyTitle')}</h3>
          <p>{t('emptyConversation')}</p>
        </div>}
        <ol className={css.messages} aria-live="polite" aria-relevant="additions text">
          {project.messages.map(item => {
            const hasExcerpt = item.role === 'assistant' && item.text.startsWith('本阶段已生成成果，请审阅。\n\n')
            const legacyReview = hasExcerpt && reviewing && run && latestMessage?.id === item.id && !item.review && reviewFiles.length > 0
            const review = item.review ?? (legacyReview ? { runId: run.id, documents: reviewFiles } : undefined)
            return <li className={css.message} data-role={item.role} key={item.id}>
              {item.role === 'user' ? <UserMessageBubble>{item.text && <p>{item.text}</p>}{filesInBubble(item.uploads)}</UserMessageBubble> : <>
                <MarkdownText text={hasExcerpt && review ? item.text.split('\n', 1)[0] ?? '' : item.text} labels={markdownLabels} omitHtml />
                {review?.documents.map(document => <ConversationDocument key={document.path} document={document}
                  url={artifactUrl(projectId, review.runId, document.path)} download={artifactUrl(projectId, review.runId, document.path, true)} t={t} />)}
                {item.record && recordUrl && <ConversationDocument
                  document={{ path: item.record.id, name: item.record.title + '.md', kind: 'markdown' }}
                  url={recordUrl(projectId, item.record.id)} download={recordUrl(projectId, item.record.id)} t={t} />}
                {recordUrl && item.figures?.map(figure => <ConversationDocument key={figure.path} document={figure}
                  url={recordUrl(projectId, figure.path, 'file')} download={recordUrl(projectId, figure.path, 'file')} t={t} />)}
              </>}
            </li>
          })}
          {sent && <li className={css.message} data-role="user"><UserMessageBubble>
            {sent.message && <p>{sent.message}</p>}{filesInBubble(sent.uploads)}
          </UserMessageBubble></li>}
          {sent && <li className={css.message} data-role="assistant"><p className={css.quiet} role="status">{t('assistantWorking')}</p></li>}
        </ol>
        {reviewing && <section className={css.review} aria-label={t('reviewArtifacts')}>
          <strong>{reviewedStage ? stageLabel(reviewedStage.id, t) : t('reviewArtifacts')}</strong>
          {reviewFiles.length > 0 && <ul className={css.artifacts}>{reviewFiles.map(file => <li key={file.path}>
            <a href={artifactUrl(projectId, run.id, file.path, true)} download={file.name}>{file.name}</a>
          </li>)}</ul>}
        </section>}
      </div>
      <div className={css.compose}>
        {failure && <p className={css.notice} role="alert">{failure}</p>}
        {agentDriven && project.agent?.failure && <p className={css.notice} role="status">{project.agent.failure}</p>}
        {refreshFailed && <p className={css.notice} role="status">{t('refreshError')}</p>}
        <form className={css.composer} data-dragging={dragging || undefined} onSubmit={submit}
          onDragOver={event => {
            if (upload && event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) }
          }}
          onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false) }}
          onDrop={event => {
            if (!upload || !event.dataTransfer.files.length) return
            event.preventDefault()
            setDragging(false)
            void addFiles(Array.from(event.dataTransfer.files))
          }}>
          {upload && <input type="file" ref={fileInput} hidden multiple accept=".csv,.tsv,.xlsx,.json,.parquet,.txt,.md,.pdf,.docx,.zip,.png,.jpg,.jpeg,.webp"
            onChange={event => {
              if (event.currentTarget.files) void addFiles(Array.from(event.currentTarget.files))
              event.currentTarget.value = ''
            }} />}
          {draftUploads.length > 0 && <div className={css.draftUploads}>{draftUploads.map(file => <span className={css.attachment} key={file.id}>
            {uploadUrl && /^(png|jpe?g|webp)$/u.test(file.kind) && <img src={uploadUrl(projectId, file.id)} alt="" />}
            <span>{file.name}</span>
            <button type="button" aria-label={t('removeAttachment', { name: file.name })} onClick={() => { setDraftUploads(previous => previous.filter(item => item.id !== file.id)) }}>×</button>
          </span>)}</div>}
          {uploading && <span className={css.uploadStatus} role="status">{t('uploading')}</span>}
          <textarea ref={composerInput} aria-label={t('promptLabel')} rows={2} value={prompt} maxLength={acceptingFeedback ? 1800 : 10000} required={!draftUploads.length}
            placeholder={t(agentDriven ? 'agentPlaceholder' : processing ? 'runningFeedbackPlaceholder' : acceptingFeedback ? 'feedbackPlaceholder' : 'promptPlaceholder')} onChange={event => { setPrompt(event.currentTarget.value) }}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
              if (event.ctrlKey || event.metaKey) {
                const input = event.currentTarget
                event.preventDefault()
                if (input.value.length - (input.selectionEnd - input.selectionStart) < input.maxLength) {
                  input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end')
                  setPrompt(input.value)
                }
                return
              }
              if (!event.shiftKey && !event.altKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }} />
          <div className={css.composerFooter}>
            <div className={css.composerActions}>
              {upload && <button type="button" className={css.uploadButton} aria-label={t('addAttachment')} title={t('addAttachment')}
                disabled={uploading || pending !== undefined || (!agentDriven && draftUploads.length >= 8)}
                onClick={() => { fileInput.current?.click() }}><IconPlusOutlineRegular size={17} /></button>}
              {(processing || reviewing) && <button type="button" className={css.button} disabled={pending !== undefined}
                onClick={() => { void mutate({ action: 'cancel', projectId, runId: run.id }) }}><IconPauseOutlineRegular size={15} />{t('stopRun')}</button>}
              {agentDriven && active && <button type="button" className={css.button} disabled={pending !== undefined}
                onClick={() => { void mutate({ action: 'cancel', projectId }) }}><IconPauseOutlineRegular size={15} />{t('stopRun')}</button>}
              {agentDriven && !active && project.agent?.paused && <button type="button" className={css.button} disabled={pending !== undefined}
                onClick={() => { void mutate({ action: 'resume', projectId }) }}><IconPlayOutlineRegular size={15} />{t('resumeRun')}</button>}
              {agentDriven && !active && project.agent?.pendingReview && <button type="button" className={css.primary} disabled={pending !== undefined}
                onClick={() => {
                  const review = project.agent?.pendingReview
                  if (review) void mutate({ action: 'submit', projectId, message: t('approveResearchDecision', { name: review.title, id: review.id }) })
                }}>{t('confirmStage')}</button>}
              {resumable && <button type="button" className={css.button} disabled={pending !== undefined}
                onClick={() => { void mutate({ action: 'resume', projectId, runId: run.id }) }}><IconPlayOutlineRegular size={15} />{t('resumeRun')}</button>}
              {reviewing && run.gate?.decisions.includes('approve') && <button type="button" className={css.primary} disabled={pending !== undefined}
                onClick={() => { void mutate({ action: 'respond', projectId, runId: run.id, decision: 'approve' }) }}>
                {t(reviewedStage?.number === catalog.stages.length ? 'finishReview' : 'confirmStage')}</button>}
              {sent && <button type="button" className={css.button} onClick={() => { sendController.current?.abort() }}>{t('stopWaiting')}</button>}
            </div>
            <div className={css.composerTrailing}>
              <span className={css.modelLabel}>{(!agentDriven && active && run?.model) || catalog.model || run?.model || t('modelUnset')}
                {catalog.reasoningEffort && (agentDriven || !active || run?.model === catalog.model) && <span className={css.reasoningEffort}>{catalog.reasoningEffort}</span>}
              </span>
              <button type="submit" className={css.send} aria-label={t(acceptingFeedback ? 'sendFeedback' : 'send')} title={t(acceptingFeedback ? 'sendFeedback' : 'send')}
                disabled={(!prompt.trim() && !draftUploads.length) || uploading || pending !== undefined}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.74929 1.87569 10.0596 2.18604L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L5.94043 2.18604C6.25071 1.87569 6.51276 1.61297 6.7373 1.43233C7.021 1.20418 7.33231 1.0531 7.6875 0.980183Z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
    {agentDriven ? <AgentPanel project={project} t={t} artifactUrl={artifactUrl} {...(recordUrl ? { recordUrl } : {})} />
      : <StagePanel projectId={projectId} run={run} stages={catalog.stages} artifactUrl={artifactUrl} t={t} />}
  </>
}

function ConversationDocument({ document, url, download, t }: {
  document: ResearchArtifact; url: string; download: string; t: ResearchTranslate
}) {
  const markdown = document.kind === 'markdown' || document.name.endsWith('.md')
  const previewable = markdown || ['text', 'csv', 'json', 'html'].includes(document.kind ?? '')
  const [open, setOpen] = useState(markdown)
  const [content, setContent] = useState<string>()
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!open || !previewable || content !== undefined) return
    const controller = new AbortController()
    void fetch(url, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error()
      return response.text()
    }).then(text => { if (!controller.signal.aborted) setContent(text) }, () => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => { controller.abort() }
  }, [content, open, previewable, url])
  const link = <a href={download} download={document.name}>{document.name}</a>
  if (document.kind === 'image') return <figure className={css.document}>
    <img src={url} alt={document.caption ?? document.name} loading="lazy" />
    {document.caption ? <figcaption>{document.caption} {link}</figcaption> : link}
  </figure>
  const body = error ? <p role="alert">{t('documentError')}</p> : content === undefined ? <p role="status">{t('loadingDocument')}</p>
    : markdown ? <MarkdownText text={content} labels={markdownLabels} omitHtml /> : <pre>{content}</pre>
  if (markdown) return <section className={css.document} aria-label={document.name}>{link}{body}</section>
  if (previewable) return <details className={css.document} onToggle={event => { setOpen(event.currentTarget.open) }}>
    <summary>{document.name}</summary>{link}{body}
  </details>
  return <p className={css.document}>{link}</p>
}

