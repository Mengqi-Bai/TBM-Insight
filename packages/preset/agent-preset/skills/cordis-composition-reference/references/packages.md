# Loadable Harness plugin packages

This file is GENERATED from workspace manifests (`scripts/gen-plugin-packages.ts`) and verified fresh by `pnpm run verify-plugin-packages` (part of `doc-sync`); do not edit it by hand.

Every package below exports a Cordis plugin that a bundle patch can name in a Loader row. `Config` marks packages whose row accepts a `config` mapping; query `Config.listConfigs` through `cordis_inspect_query` (filter by `name`, then query the `entry` id) for the mounted schema. Packages under `experimental` are pre-stable.

## acp

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/acp` | yes | Automation-only Agent Client Protocol server for driving TBM Insight agents over JSON-RPC stdio |

## api

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/api-account-controller` | no | Expose safe account operations over authenticated Remote |
| `@tbm-insight/api-gateway` | yes | Typert Remote Host dispatcher and Client API endpoint |
| `@tbm-insight/api-job-controller` | yes | Job Remote observation stream and the reference-counted client job-output service |
| `@tbm-insight/api-remote-access` | no | Method-level Remote access control for non-owner Peers and the per-Peer access snapshot |
| `@tbm-insight/api-remotes` | no | Remote BFF assembly for application-selected Host capabilities |
| `@tbm-insight/api-session-controller` | yes | Session Remote commands, cold reads, and live control transport |
| `@tbm-insight/api-settings-controller` | yes | Remote owner for the configuration surfaces over the settings-domain seams |
| `@tbm-insight/api-terminal-controller` | yes | Session-owned interactive terminals with shell discovery, screen recovery and typed Remote control |
| `@tbm-insight/api-workspace-controller` | yes | Workspace Remote commands and reconnect-safe state transport |
| `@tbm-insight/api-workspace-files` | yes | Workspace file service and Client resource provider: bounded reads, directory listing, and live metadata over the workspaceFiles Remote namespace |

## attachment

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/attachment-local` | yes | Private content-addressed TBM_ENGINE_HOME attachment storage |

## boot

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/config-editor` | no | Persist plugin configuration through profile patches and Loader reconciliation |
| `@tbm-insight/hmr` | yes | Coordinated module and profile configuration hot reload |
| `@tbm-insight/plugin-manager` | yes | Current-profile plugin and bundle management shared by tbm CLI, Web and agent tools |
| `@tbm-insight/plugin-market` | yes | Configured plugin market indexes for the Web Discover page and the plugin_market agent tool |

## browser-use

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/browser-use` | no | Exclusive named browser-use provider registration |

## bundle

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/acp-app` | no | The tbm ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over tbm-base |
| `@tbm-insight/headless` | yes | The tbm one-shot bundle: a direct core Agent/Session runner over tbm-base with no Host, HTTP, or browser layer |
| `@tbm-insight/sdk-app` | yes | The tbm SDK profile bundle: stdio JSON-RPC serving and process lifecycle over tbm-base |
| `@tbm-insight/web-app` | yes | The tbm browser-surface bundle: the web patch layer over tbm-base plus the runtime glue plugin (frontend dist serving, bash runtime variables, URL line) |

## client

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/client-connection` | yes | Authenticated RPC transport and generation lifecycle |
| `@tbm-insight/client-file-upload` | no | Agent-scoped browser file upload, streaming intake, and staged receipt service |
| `@tbm-insight/client-hmr` | yes | Web client graph synchronization and rebuilt-bundle reload transport |
| `@tbm-insight/client-locale` | no | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |
| `@tbm-insight/client-modules` | no | Client module system, dual-face: node half composes the __TBM_ENGINE_BOOT__ entry graph (incremental tbm.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |
| `@tbm-insight/client-product-analytics` | yes | Desktop product event collection and authenticated Host reporting |
| `@tbm-insight/client-resources` | no | Unified client resource model: protocol-registered providers turn URL addresses into live values, consumed through the useResource global standard hook |
| `@tbm-insight/client-shortcuts` | yes | Application keyboard command registry and physical-key routing |
| `@tbm-insight/client-ui-agent-preset` | no | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |
| `@tbm-insight/client-ui-agent-team` | no | Web shared task board for a subagent tree |
| `@tbm-insight/client-ui-approval` | no | Approval composer takeover over the scoped Remote Event waterfall |
| `@tbm-insight/client-ui-attachment` | no | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |
| `@tbm-insight/client-ui-brand-official` | no | Official TBM Insight brand occupants for the Web client's sidebar slots |
| `@tbm-insight/client-ui-chat` | no | Chat Conversation target, node definitions, renderers, and details surface |
| `@tbm-insight/client-ui-commands` | no | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |
| `@tbm-insight/client-ui-context-menu` | no | Typed, plugin-extensible context menus with captured targets and shared Web presentation |
| `@tbm-insight/client-ui-conversation` | no | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |
| `@tbm-insight/client-ui-deliverables` | no | Changed-files card with per-file comparison tabs, delivery cards, and clickable final-response file references for Web |
| `@tbm-insight/client-ui-directory-picker-browse` | no | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |
| `@tbm-insight/client-ui-directory-picker-native` | no | Native directory-picker surface: the renderless workspace directory-flow occupant driving the local Desktop or Host OS chooser |
| `@tbm-insight/client-ui-entry-customization` | no | Customize plugin entries in the left sidebar, conversation views, and right sidebar, and quickly create new plugins. |
| `@tbm-insight/client-ui-file-actions` | no | Original-file saving and image clipboard actions for Web and Desktop |
| `@tbm-insight/client-ui-file-drag` | no | Application-owned file drag transfers and localized failure feedback |
| `@tbm-insight/client-ui-goal` | no | Session goal surface: GoalBar docked above the composer, read from the goal session projection |
| `@tbm-insight/client-ui-input-trigger` | no | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |
| `@tbm-insight/client-ui-jobs` | no | Session-header background-job list with on-demand streaming record panels |
| `@tbm-insight/client-ui-layout` | no | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |
| `@tbm-insight/client-ui-message-feedback` | no | The Web feedback surface: per-message Like/Dislike in the assistant-message action strip and the feedback dialog behind both ratings and /feedback, backed by the messageFeedback and sessionFeedback Host Remotes |
| `@tbm-insight/client-ui-model-selection` | no | Model selection over the shared model catalog, Session projection, and session.selectModel |
| `@tbm-insight/client-ui-open-in-app` | no | Web "Open In..." controls: the Session-header split button opening the workspace directory in an installed application, and the document preview's default-application controls for one file |
| `@tbm-insight/client-ui-permission-presets` | no | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |
| `@tbm-insight/client-ui-plan` | no | Plan mode controls, persistent transcript plan cards, and sidebar Markdown previews |
| `@tbm-insight/client-ui-plugin-manager` | yes | Plugin management for the tbm web client: the sidebar Plugins panel installs, enables, disables, retries, and composes installed plugin packages |
| `@tbm-insight/client-ui-plugin-market` | no | Discover tab of the tbm web Plugins page: browse configured plugin market indexes and install their bundles |
| `@tbm-insight/client-ui-reference` | no | Unified Web @file and @session reference source |
| `@tbm-insight/client-ui-renderer` | no | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |
| `@tbm-insight/client-ui-schedule` | no | Host task management page and Session reminder catalog |
| `@tbm-insight/client-ui-secret-mask` | no | Web display masking for recognized credentials in sent user text |
| `@tbm-insight/client-ui-session` | no | Session Controller adapter for React and session-scoped slots |
| `@tbm-insight/client-ui-settings` | no | Settings domain base plugin: shared configuration forms and the canonical settings slot-type contract |
| `@tbm-insight/client-ui-settings-account` | yes | Manage DeepSeek login and open Platform billing pages |
| `@tbm-insight/client-ui-settings-agent-loop` | no | Settings page of the agent loop on the tbm web client's Plugins page: the parallel tool-call cap of the agent-loop namespace |
| `@tbm-insight/client-ui-settings-general` | no | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |
| `@tbm-insight/client-ui-settings-models` | yes | Models settings and shared product-onboarding dialogs over existing settings and credential joins |
| `@tbm-insight/client-ui-settings-plugin-inventory` | no | Read-only Cordis Loader inventory tab in Web Plugins settings |
| `@tbm-insight/client-ui-settings-plugins` | no | Built-in plugins settings section for the tbm web client: the Settings navigation entry and the tab chrome feature-owned tabs register into |
| `@tbm-insight/client-ui-settings-session-log` | no | General settings control for Session-log upload with DeepSeek API requests |
| `@tbm-insight/client-ui-settings-shell` | no | Settings page of the shell executor on the tbm web client's Plugins page: the command timeout and the per-stream output cap of the shell namespace |
| `@tbm-insight/client-ui-settings-subagent` | no | Settings page of Subagent delegation on the tbm web client's Plugins page: recursion depth, parallel capacity, and the models agents may choose for subagents |
| `@tbm-insight/client-ui-settings-web-search` | no | Settings page for web search and fetch on the tbm web client's Plugins page: the Search and Fetch provider menus, the DeepSeek Search API result count, and legacy Messages search settings |
| `@tbm-insight/client-ui-shortcuts` | no | Keyboard shortcut reference, recording, and local preference editing |
| `@tbm-insight/client-ui-sidebar` | no | Sidebar plugin: session multi-level tree, search, grouping, state dots |
| `@tbm-insight/client-ui-sidebar-browser` | no | Sandboxed Web browser tabs for the right Sidebar |
| `@tbm-insight/client-ui-sidebar-documentpreview` | yes | Extensible Sidebar previews for Office documents, spreadsheets, Markdown, code, images, PDF, HTML, and plain text |
| `@tbm-insight/client-ui-sidebar-files` | no | The workspace files page and one workspace directory tree per pane beside docked and floating file previews, listed lazily over the workspaceFiles Remote namespace |
| `@tbm-insight/client-ui-sidebar-right` | no | Right Sidebar: the docking surface's session-bound state, its panel and header expand control, and the navigation service over it |
| `@tbm-insight/client-ui-sidebar-terminal` | no | Interactive shell tabs for the right Sidebar |
| `@tbm-insight/client-ui-skill` | no | Web skill references and the dedicated skill tool row |
| `@tbm-insight/client-ui-subagent` | no | Subagent conversation catalog, continuation routing UI, and '@' reference source |
| `@tbm-insight/client-ui-theme` | yes | Theme plugin: Host bootstrap for the pre-plugin palette; ThemeRuntime for light/dark/system state and icon replacements; --dsw-* token styles and Appearance settings row |
| `@tbm-insight/client-ui-tool` | no | Client Tool call-tree renderer and keyed per-tool presentation slot |
| `@tbm-insight/client-ui-trajectory` | yes | Trajectory event ledger and timing overview with live tool-result inspection |
| `@tbm-insight/client-ui-user-questions` | no | Web ask_user_question composer takeover and plan-review presentation UI |
| `@tbm-insight/client-ui-workflow-run` | no | Durable workflow-run Conversation Node and nested member disclosure for tbm web |
| `@tbm-insight/client-ui-workspace` | no | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |

## compaction

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/command-compact` | no | Human-facing slash command for explicit session compaction |
| `@tbm-insight/compaction-basic` | yes | Token-meter-driven compaction policy and LLM summarization backend for the TBM Insight |
| `@tbm-insight/compaction-image-offload` | no | Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry |
| `@tbm-insight/compaction-tool-result-pruner` | yes | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |

## computer-use

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/computer-use` | no | Exclusive named computer-use provider registration |

## context

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/agent-instructions` | yes | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |
| `@tbm-insight/file-reference-local` | yes | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |
| `@tbm-insight/harness-dev-context` | no | Model context naming the TBM Insight checkout and Web GUI URL without letting either change the system prompt |
| `@tbm-insight/session-reference` | yes | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |
| `@tbm-insight/time-context` | yes | Durable per-step context with the current time and elapsed time |
| `@tbm-insight/tmux-context` | yes | Opt-in durable per-step context with this agent's tmux pane and window location |

## core

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/agent` | no | Agent interface, registry, initiator scope, and event vocabulary for the TBM Insight |
| `@tbm-insight/agent-default-model` | yes | Default model selection shared by Agent entry points |
| `@tbm-insight/agent-loop` | yes | The concrete agent loop plugin for the TBM Insight |
| `@tbm-insight/agent-tool-presentation` | yes | Deprecated tool presentation selector; use tbm-tool-executor-native or tbm-tool-executor-ptc directly |
| `@tbm-insight/session` | no | Event-sourced session store for the TBM Insight |
| `@tbm-insight/system-prompt` | yes | System prompt assembly registry for the TBM Insight |
| `@tbm-insight/tool-executor-native` | no | Native tool execution plugin |
| `@tbm-insight/tool-executor-ptc` | yes | PTC program execution, tool bindings, and generated SDK prompts |
| `@tbm-insight/tools` | no | Tool registry and execution pipeline for the TBM Insight |

## credentials

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/authorization` | no | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |
| `@tbm-insight/credentials-local` | yes | File-backed credentials provider ($TBM_ENGINE_HOME/.env under the live process environment) for the TBM Insight |
| `@tbm-insight/deepseek-account-platform` | yes | Authorize DeepSeek accounts through browser PKCE |

## deliverables

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/deliverable-file-references` | no | Shared model guidance for file links and deliverables across TBM Insight hosts |
| `@tbm-insight/tool-present` | yes | Explicit workspace file delivery declarations for the TBM Insight |
| `@tbm-insight/workspace-changes` | yes | Per-turn workspace file changes recorded from git working-tree snapshots and whole-file captures, with per-file comparisons, for the TBM Insight |

## document

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/office-to-pdf` | yes | Shared Office-to-PDF conversion with bounded queues and caching |

## experimental

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/action-cards` | yes | Optional action cards below answers: one shared proposal tool, card state, user actions and status notices |
| `@tbm-insight/client-ui-action-cards` | no | Action cards below completed answers: the shared card frame, kind bodies and the compact tool row |
| `@tbm-insight/client-ui-creation-recommendations` | no | Body of the personalized page card: location choice, creation progress, Undo and Restore |
| `@tbm-insight/client-ui-plugin-recommendations` | no | Official plugin card body with catalog text and enabling |
| `@tbm-insight/creation-recommendations` | no | Create persistent removable interface plugins from explicit conversation needs |
| `@tbm-insight/cua` | no | Shared Computer Use application objects, authorization, and logged tool execution |
| `@tbm-insight/experimental-api-speech-to-text` | yes | Authenticated experimental speech transcription for browser clients |
| `@tbm-insight/experimental-auto-review` | no | Per-tool LLM authorization review for the TBM Insight Auto permission preset |
| `@tbm-insight/experimental-browser-use-chrome-devtools-mcp` | yes | Experimental per-Session Chromium browser tools through chrome-devtools-mcp |
| `@tbm-insight/experimental-browser-use-playwright-mcp` | yes | Experimental per-Session Chromium browser tools through @playwright/mcp |
| `@tbm-insight/experimental-browser-use-stagehand-native` | yes | Experimental Stagehand browser tools with separately configured native models |
| `@tbm-insight/experimental-claude-code-mods` | yes | Experimental bridge: load Claude Code mods (hooks modules) and run their hook chains on TBM Insight extension points |
| `@tbm-insight/experimental-client-ui-claude-code-mods` | no | Web band above the prompt for Claude Code mods: draws each session's mod tree and sends button presses back to the bridge |
| `@tbm-insight/experimental-client-ui-cot-translation` | yes | Optional machine translation of expanded reasoning, preserving original Session text |
| `@tbm-insight/experimental-client-ui-forge` | yes | Sidebar panel for a Session's change requests, with a worktree option for new Sessions and its Host Remote |
| `@tbm-insight/experimental-client-ui-stats` | no | Per-turn and per-step context, timing, cache, and tool-cost table contributed as an experimental conversation View |
| `@tbm-insight/experimental-client-ui-voice-input` | no | Record speech and insert editable text into the conversation draft |
| `@tbm-insight/experimental-computer-use-cua-driver-mcp` | yes | Experimental computer use through an installed Cua Driver MCP executable |
| `@tbm-insight/experimental-computer-use-cua-driver-native` | no | Experimental computer-use provider embedding the Cua Driver native npm SDK |
| `@tbm-insight/experimental-cua-macos` | yes | macOS native provider for shared Computer Use application and window objects |
| `@tbm-insight/experimental-forge` | yes | Provider-neutral change request registry with shared status polling |
| `@tbm-insight/experimental-forge-github` | yes | GitHub provider for the experimental forge registry, read through the GitHub CLI on the host |
| `@tbm-insight/experimental-forge-session` | yes | Binds change requests to the Session that created, pushed, or tracked them |
| `@tbm-insight/experimental-inspector` | yes | Experimental cross-realm CDP hub for Host debugging and Client Runtime inspection |
| `@tbm-insight/experimental-ptc-runtime-python` | yes | CPython subprocess implementation of the TBM Insight PTC execution seam |
| `@tbm-insight/experimental-session-inspector` | no | Experimental virtualized Session log and live Chat group/node inspectors |
| `@tbm-insight/experimental-speech-to-text` | yes | Experimental speech recognition with independently selectable providers |
| `@tbm-insight/experimental-speech-to-text-sensevoice` | yes | Local SenseVoice ONNX transcription with a managed sherpa-onnx process |
| `@tbm-insight/experimental-subagent-oar` | yes | Experimental one-shot subagents through OAR runtimes |
| `@tbm-insight/experimental-tool-subagent-oar` | yes | Delegate standalone tasks to configured external subagent providers |
| `@tbm-insight/experimental-tool-worktree` | no | Model tool that creates and enters a new Git worktree |
| `@tbm-insight/experimental-translator` | yes | Machine translation with reusable Session results |
| `@tbm-insight/experimental-worktree` | yes | Creates a named Git worktree and changes the calling Session working directory |
| `@tbm-insight/hooks-claude-code` | yes | Bridge plugin: run a Claude Code hooks.json / settings hook config on the TBM Insight interception seams |
| `@tbm-insight/hooks-codex` | yes | Bridge plugin: run a Codex hooks.json hook config on the TBM Insight interception seams |
| `@tbm-insight/plugin-recommendations` | no | Official plugin suggestions with explicit user activation and persistent conversation decisions |
| `@tbm-insight/session-title-all-prompts-llm` | yes | All-user-messages LLM provider plugin for TBM Insight session titles |
| `@tbm-insight/skill-badge` | no | Bundled tbm badge skill provider for TBM Insight |
| `@tbm-insight/tool-ralph` | yes | Model-facing fresh-agent Ralph loop over the workflow and subagent seams |
| `@tbm-insight/tool-session-query` | yes | Workspace-authorized model-facing session history search, trace, and event read tools |
| `@tbm-insight/tool-terminal` | yes | Six model-facing persistent PTY tools with owner isolation and generic background-job integration |
| `@tbm-insight/webhook` | no | Fire-and-forget webhook rule runtime that creates Workspace-backed TBM Insight Sessions |
| `@tbm-insight/webhook-github` | yes | Signed GitHub HTTP webhook adapter for the TBM Insight webhook runtime |

## extensions

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/client-ui-cordis` | no | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |
| `@tbm-insight/cordis-client-runner` | no | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |
| `@tbm-insight/cordis-host-runner` | yes | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |
| `@tbm-insight/tool-cordis` | no | Read-only runtime API inspection for Harness plugin development |

## feedback

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/command-feedback` | no | Log-only session feedback: the record event, the sessionFeedback Host Remote, and the human-facing slash command |
| `@tbm-insight/message-feedback` | yes | Canonical Session-log ratings and notes for finalized assistant messages |

## fs

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/fs-local` | yes | Local-filesystem implementation of the TBM Insight filesystem seam (ctx.fs) |
| `@tbm-insight/fs-observation-policy` | no | File-context policy plugin for the TBM Insight — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |
| `@tbm-insight/fs-sandbox` | yes | Sandbox-enforcing implementation of the TBM Insight filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |
| `@tbm-insight/tool-fs` | yes | Model-facing filesystem tools (read, write, edit) over the TBM Insight filesystem seam (ctx.fs) |
| `@tbm-insight/tool-fs-search` | yes | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) |
| `@tbm-insight/tool-str-replace-editor` | yes | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service |

## goal

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/command-goal` | no | Human-facing slash command for persisted same-session goals |
| `@tbm-insight/goal` | yes | Event-sourced same-session goal state and lifecycle service for the TBM Insight |
| `@tbm-insight/goal-round-driver` | no | Race-fenced same-session goal-round driver |
| `@tbm-insight/tool-goal` | yes | Model-facing same-session goal tools with execution-time authority checks |

## guard

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/repeat-tool-reminder` | yes | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |
| `@tbm-insight/tool-call-timeout-policy` | no | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |

## host

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/host-directory-picker-auto` | no | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the TBM Insight web GUI host |
| `@tbm-insight/host-directory-picker-browse` | yes | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |
| `@tbm-insight/host-directory-picker-native` | no | Native-OS-chooser backend of the directory-picker seam for the TBM Insight web GUI host |
| `@tbm-insight/host-frontend-static` | yes | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |
| `@tbm-insight/host-open-in-app` | yes | Host half of open-in-app: resolved application catalog, icons, and the launch endpoint as three webServer routes |
| `@tbm-insight/host-plugin-inventory` | no | Read-only Remote projection of current Cordis Loader plugin state |
| `@tbm-insight/host-product-telemetry-otel` | yes | Explicit product usage events exported through OpenTelemetry HTTP logs |
| `@tbm-insight/host-webserver` | yes | Web route-registration plugin: HTTP and upgrade routes, per-Peer index transform taps, and static dist fallback |

## interaction

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/commands` | no | Plugin-owned human command registry for TBM Insight UIs |
| `@tbm-insight/permission-presets` | yes | User-facing permission presets (ctx.permissionPresets) for the TBM Insight: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |
| `@tbm-insight/tool-ask-user` | yes | Model-facing ask_user_question tool over the ctx.userQuestions seam |
| `@tbm-insight/user-approval` | yes | User-approval seam (ctx.approval) for the TBM Insight: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `@tbm-insight/user-questions` | no | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |

## jobs

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/jobs-local` | yes | Process-local implementation of the TBM Insight background job registry seam |
| `@tbm-insight/tool-jobs` | yes | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry |

## llm

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/deepseek-llm-api-extensions` | no | Additive request-field registry for the official DeepSeek LLM API adapter |
| `@tbm-insight/llm` | no | Provider-neutral LLM service interface for the TBM Insight |
| `@tbm-insight/llm-deepseek-account` | yes | DeepSeek account provider authentication and discovery |
| `@tbm-insight/llm-deepseek-api-key` | yes | DeepSeek api-key provider authentication and discovery |
| `@tbm-insight/llm-pi-ai` | yes | pi-ai-backed DeepSeek adapter for the TBM Insight LLM seam (design-verification twin of tbm-llm-deepseek) |
| `@tbm-insight/llm-retry` | yes | Provider-routed LLM request retry policy for the TBM Insight |
| `@tbm-insight/plugin-package-inventory-deepseek` | yes | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |
| `@tbm-insight/token-meter` | yes | Replay-aware token measurement service (ctx.tokenMeter) for the TBM Insight |

## lsp

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/lsp` | no | Abstract LSP capability seam (ctx.lsp) for the TBM Insight — language-server provider registry keyed by branded id and extension mapping, order-independent per-query selection, normalized definition/references/implementation/hover requests and results, and the LspError taxonomy |
| `@tbm-insight/lsp-stdio` | yes | Generic stdio language-server provider for the TBM Insight LSP capability seam (ctx.lsp) — spawns configured servers, translates JSON-RPC, and serves transient-open goToDefinition/findReferences/goToImplementation/hover queries in the host filesystem namespace |
| `@tbm-insight/tool-lsp` | yes | Model-facing lsp tool over the TBM Insight LSP capability seam (ctx.lsp) — one read-only tool with goToDefinition/findReferences/goToImplementation/hover operations, one-based UTF-16 cursor coordinates, bounded location rendering, and hover normalization |

## mcp

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/mcp-client` | yes | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |
| `@tbm-insight/mcp-manager` | yes | MCP server manager: a settings-driven fleet of mcp-client instances with runtime status, restart, and probe |
| `@tbm-insight/mcp-resources` | no | Scoped MCP resource discovery and reading through shared model tools |

## plan

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/plan-mode` | yes | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |

## preset

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/agent-preset` | yes | Declare an Agent capability composition in Cordis YAML |
| `@tbm-insight/agent-preset-registry` | yes | Declarative Agent preset registry and profile-backed editing |
| `@tbm-insight/persona` | yes | Composition-authored deployment persona section for the TBM Insight |

## ptc-runtime

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/ptc-runtime-node` | yes | Node PTC execution with async function, REPL and VM Script evaluators and optional retained state |

## sandbox

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/sandbox-local` | yes | Local process-sandbox backends for the TBM Insight sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |
| `@tbm-insight/sandbox-policy` | yes | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |

## schedule

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/schedule` | yes | Host-wide durable reminders with shared management and delivery to existing or new Sessions |
| `@tbm-insight/tool-schedule` | no | Model-facing scheduled task tools (schedule_create, schedule_list, schedule_view, schedule_edit) over the Host ctx.schedule service |

## sdk

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/sdk-jsonrpc-server` | yes | Stdio JSON-RPC server plugin for out-of-process TBM Insight SDK clients |

## session

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/message-quotes` | no | Selected-text quotation and Markdown blockquote presentation |
| `@tbm-insight/session-checkpoint-policy` | no | Semantic session durability checkpoints before model requests and tool side effects |
| `@tbm-insight/session-log-deepseek` | yes | Incremental lossless session-log request extension for the official DeepSeek LLM API |
| `@tbm-insight/session-persistence-jsonl` | yes | JSONL durable session persistence backend for the TBM Insight |
| `@tbm-insight/session-projection` | no | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `@tbm-insight/session-projection-cache` | yes | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |
| `@tbm-insight/session-stats` | no | Whole-log conversation counts and wall times projection (sessionStats) for the TBM Insight |
| `@tbm-insight/session-telemetry-otel` | yes | Feedback-authorized Session logs over byte-bounded OpenTelemetry HTTP requests |
| `@tbm-insight/session-title` | yes | Log-backed session title service and provider registry for the TBM Insight |
| `@tbm-insight/session-title-first-prompt-llm` | yes | First-message LLM provider plugin for TBM Insight session titles |
| `@tbm-insight/session-turn-outline` | no | Whole-log turn outline projection (turnOutline) for the TBM Insight |
| `@tbm-insight/tool-working-directory` | no | Read and change the active Session working directory |
| `@tbm-insight/working-directory` | yes | Session working directories with durable changes and model context |

## session-query

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/session-log-export` | yes | Web Session-log ZIP export and Session Markdown copy |
| `@tbm-insight/session-query-sqlite` | yes | Concrete ctx.sessionQuery backend with SQLite FTS5 search |

## settings

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/settings` | no | Abstract user-settings seam (ctx.settings) for the TBM Insight |

## shell

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/bash-local` | yes | Local-subprocess implementation of the TBM Insight bash executor seam |
| `@tbm-insight/bash-sandbox` | yes | Sandbox-consuming implementation of the TBM Insight bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@tbm-insight/pwsh-local` | yes | Local PowerShell implementation of the TBM Insight bash executor seam |
| `@tbm-insight/pwsh-sandbox` | yes | Sandbox-consuming implementation of the TBM Insight PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |
| `@tbm-insight/shell-env` | yes | Tool-independent managed TBM_ENGINE_* shell environment registry |
| `@tbm-insight/tool-bash` | yes | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `@tbm-insight/tool-bash-persistent` | yes | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service |
| `@tbm-insight/tool-pwsh` | yes | Model-facing pwsh tool over the bash executor seam |
| `@tbm-insight/tool-pwsh-persistent` | yes | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service |

## skill

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/skill` | yes | Agent skill provider registry for the TBM Insight |
| `@tbm-insight/skill-filesystem` | yes | Local filesystem skill provider for the TBM Insight |
| `@tbm-insight/skill-office` | yes | Bundled Word, PowerPoint, and Excel workflows and LibreOffice Kit operations |
| `@tbm-insight/tool-skill` | yes | Model-facing skill loading tool for the TBM Insight |
| `@tbm-insight/tool-workspace-dependencies` | yes | The load_workspace_dependencies tool: absolute paths into a bundled Python, Node.js, and pnpm payload |

## spill

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/spill-local` | yes | Local-filesystem implementation of the TBM Insight spill storage seam (private session-scoped files) |
| `@tbm-insight/spill-policy` | yes | Token-budgeted tool-result retention with recoverable text and image paths |

## ssh

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/fs-ssh` | no | Filesystem provider over the shared POSIX SSH helper |
| `@tbm-insight/sandbox-ssh` | no | Remote POSIX sandbox argv provider over the shared SSH helper |
| `@tbm-insight/ssh` | yes | Shared OpenSSH connection and versioned POSIX remote helper |
| `@tbm-insight/subprocess-ssh` | no | Subprocess and terminal provider over the shared POSIX SSH helper |

## storage

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/storage` | no | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the TBM Insight |
| `@tbm-insight/storage-domain` | yes | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the TBM Insight |
| `@tbm-insight/storage-json` | yes | JSON file KV storage backend for the TBM Insight storage hub |
| `@tbm-insight/storage-sqlite` | yes | SQLite storage backend (kv facet) for the TBM Insight storage hub |

## subagent

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/subagent` | yes | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |
| `@tbm-insight/subagent-acp` | yes | Out-of-process ACP subagent backend: drives a child agent in a spawned subprocess over the Agent Client Protocol |
| `@tbm-insight/subagent-claude-code` | yes | One-shot Claude Code subagent provider over the official Agent SDK |
| `@tbm-insight/subagent-codex` | yes | One-shot Codex subagent provider over the official app-server protocol |
| `@tbm-insight/subagent-tbm-sdk` | yes | Out-of-process SDK subagent backend: drives a child TBM Insight runtime subprocess over stdio JSON-RPC through the TypeScript SDK client |
| `@tbm-insight/subagent-fork-in-process` | yes | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |
| `@tbm-insight/subagent-spawn-in-process` | yes | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |
| `@tbm-insight/tool-subagent` | yes | Model-facing subagent delegation tool over the ctx.subagents seam |
| `@tbm-insight/tool-subagent-control` | yes | Shared messaging, interruption, and child discovery tools for subagents |

## subprocess

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/subprocess-local` | no | Local-subprocess implementation of the TBM Insight subprocess seam |

## team

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/agent-team` | yes | Shared task DAG and change waits for subagent trees |
| `@tbm-insight/tool-agent-team` | yes | Scoped model-facing Agent Teams tools over ctx.agentTeams |

## telemetry

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/otel` | no | Cordis service for independent ordinary-event and byte-bounded Session-log OTLP channels |

## terminal

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/terminal` | no | Persistent PTY session seam for the TBM Insight — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |
| `@tbm-insight/terminal-bash` | yes | Persistent shell PTY backend over the TBM Insight subprocess terminal primitive |

## test-support

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/llm-replay` | yes | Replay LLM plugin: short-circuits llm/stream with model chunks reconstructed from a recorded session JSONL (keyless snapshot tests) |

## todo

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/tool-todo` | yes | Model-facing todo_write tool over the TBM Insight event-sourced session log |

## typert

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/typert-loader` | yes | Loader integration for generated Typert package contributions |

## web

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/tool-web` | yes | Model-facing web tools (web_search, web_fetch) over the TBM Insight web capability seam (ctx.web) |
| `@tbm-insight/web` | yes | Abstract web access capability seam (ctx.web) for the TBM Insight — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |
| `@tbm-insight/web-deepseek-api` | yes | DeepSeek Search and Fetch API providers for the TBM Insight web capability seam (ctx.web) |
| `@tbm-insight/web-fetch-http` | yes | Anonymous HTTP(S) fetch provider for the TBM Insight web capability seam (ctx.web) |
| `@tbm-insight/web-search-deepseek` | yes | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the TBM Insight web capability seam (ctx.web) |

## workflow

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/tool-workflow` | yes | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |
| `@tbm-insight/workflow-ptc` | yes | Workflow orchestration in the shared sandboxed Node PTC runtime |

## workspace

| Package | Config | Description |
|---|---|---|
| `@tbm-insight/workspace` | no | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the TBM Insight |
