import { SessionId } from '@deepseek-ai/dsh-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { DomainError } from './domain/errors.js'
import { workspaceKeyOf } from './domain/records.js'
import { getMindmap } from './library.js'
import { createPanelGenerationAdapter } from './host/adapters.js'
import { GenerationLockRegistry } from './host/generation-locks.js'
import { GENERATION_TIMEOUT_MS, type SubagentRuntimeLike } from './host/generation-executor.js'
import { PanelRunRegistry, type PanelRunView } from './host/panel-runs.js'
import { registerMindmapRoutes, type PanelStartRequest } from './host/routes.js'
import { createChatMindmapTools, type ChatMindmapToolDeps, type MindmapJobRegistryLike } from './host/tools.js'

export const name = '@ericwang1358/dsh-chat-mindmap'
export const inject = ['tools', 'webServer']

/** Structural slice of a live DSH agent this plugin may rely on (§6.2 cwd fence). */
interface AgentLike {
  session?: { header?: { cwd?: unknown } }
}

interface AgentRegistryLike {
  get(id: unknown): unknown
}

type InjectedServices = Record<string, unknown> & {
  /** Mirrors the cordis effect seam: factory runs now, its return disposes later. */
  effect<T>(factory: () => T, label?: string): T
}

interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Structural plugin surface. Deliberately NOT extending the cordis Context
 * interface: apply() consumes only these members, and a local effect signature
 * keeps assembly decoupled from host-side Effect generics.
 */
interface PluginContext {
  effect<T>(factory: () => T, label?: string): T
  tools: { register(tool: unknown): unknown }
  webServer: WebServerLike
  inject?(services: readonly string[], callback: (services: InjectedServices) => void): void
}

interface LiveServices {
  agents?: AgentRegistryLike
  subagents?: SubagentRuntimeLike
  jobs?: MindmapJobRegistryLike
}

function cwdOfAgent(agent: unknown): string | undefined {
  if (!agent || typeof agent !== 'object') return undefined
  const header = (agent as AgentLike).session?.header
  const cwd = header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Phase 4 integration assembly (S4-W1). Every behavior lives in the frozen
 * Phase 2/3 modules; apply() only wires dependencies and optional services.
 */
export function apply(ctx: PluginContext): void {
  const locks = new GenerationLockRegistry()
  const panelRuns = new PanelRunRegistry()
  const live: LiveServices = {}
  const capabilities = { jobs: false, subagents: false, fork: false, settings: false, toolCard: true }
  const injectOptional = ctx.inject?.bind(ctx)

  const refreshForkCapability = (): void => {
    capabilities.subagents = Boolean(live.subagents)
    capabilities.fork = Boolean(live.subagents?.getProvider('fork'))
  }

  injectOptional?.(['agents', 'subagents'], (serviceCtx) => {
    live.agents = serviceCtx.agents as AgentRegistryLike
    live.subagents = serviceCtx.subagents as SubagentRuntimeLike
    refreshForkCapability()
    serviceCtx.effect(() => () => {
      live.agents = undefined
      live.subagents = undefined
      refreshForkCapability()
    }, 'chat-mindmap: fork capability')
  })

  injectOptional?.(['jobs'], (serviceCtx) => {
    live.jobs = serviceCtx.jobs as MindmapJobRegistryLike
    capabilities.jobs = true
    serviceCtx.effect(() => () => {
      live.jobs = undefined
      capabilities.jobs = false
    }, 'chat-mindmap: jobs capability')
  })

  const workspaceKeyOfAgent = (agent: unknown): string | undefined => {
    const cwd = cwdOfAgent(agent)
    return cwd ? workspaceKeyOf(cwd) : undefined
  }
  const workspaceKeyOfSession = (sessionId: string): string | undefined => {
    const agent = live.agents?.get(SessionId(sessionId))
    return workspaceKeyOfAgent(agent)
  }

  // Getters keep the frozen factories live-wired: services attaching after
  // apply() must be visible on the next tool call without re-registration.
  const toolDeps: ChatMindmapToolDeps = {
    locks,
    get jobs() {
      return live.jobs
    },
    get runtime() {
      return live.subagents
    },
    timeoutMs: GENERATION_TIMEOUT_MS,
    workspaceKeyOfAgent,
  }
  const chatTools = createChatMindmapTools(toolDeps)
  ctx.effect(() => ctx.tools.register(chatTools.generate), 'chat-mindmap: generate_chat_mindmap')
  ctx.effect(() => ctx.tools.register(chatTools.present), 'chat-mindmap: present_chat_mindmap')

  const panelAdapter = createPanelGenerationAdapter({
    locks,
    registry: panelRuns,
    get runtime() {
      return live.subagents!
    },
    promptSourceOf: getMindmap,
    baselineVersionOf: async (libraryId) => (await getMindmap(libraryId))?.recordVersion,
  })

  const startPanelRun = async (request: PanelStartRequest): Promise<PanelRunView> => {
    const parent = request.sessionId ? live.agents?.get(SessionId(request.sessionId)) : undefined
    if (!parent) throw new DomainError('SESSION_UNAVAILABLE', 'session is not live')
    const runtime = live.subagents
    if (!runtime || !runtime.getProvider('fork')) throw new DomainError('CAPABILITY_UNAVAILABLE', 'fork subagent provider unavailable')
    refreshForkCapability()
    // §11: answer with the runId at once; settlement is observable via the
    // panel-run registry (GET /panel-runs/:id) rather than this response.
    const { view } = panelAdapter.begin({
      libraryId: request.libraryId,
      parent,
      instruction: request.instruction,
      supplementalContext: request.supplementalContext,
      timeoutMs: GENERATION_TIMEOUT_MS,
    })
    return view
  }

  ctx.effect(
    () =>
      registerMindmapRoutes({
        webServer: ctx.webServer,
        get agents() {
          return live.agents
        },
        panelRuns,
        startPanelRun,
        capabilities,
        workspaceKeyOfSession,
      }),
    'chat-mindmap: REST V2 routes',
  )

  // §18: plugin unload cancels in-flight panel runs and awaits quiescence;
  // chat job locks release through their own settlement paths.
  ctx.effect(() => () => {
    void panelRuns.disposeAll()
  }, 'chat-mindmap: panel runs dispose')
}
