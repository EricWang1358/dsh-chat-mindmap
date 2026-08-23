import { SessionId } from '@deepseek-ai/dsh-session';
import { DomainError } from './domain/errors.js';
import { workspaceKeyOf } from './domain/records.js';
import { getMindmap } from './library.js';
import { createPanelGenerationAdapter } from './host/adapters.js';
import { GenerationLockRegistry } from './host/generation-locks.js';
import { GENERATION_TIMEOUT_MS } from './host/generation-executor.js';
import { PanelRunRegistry } from './host/panel-runs.js';
import { registerMindmapRoutes } from './host/routes.js';
import { createChatMindmapTools } from './host/tools.js';
export const name = '@ericwang1358/dsh-chat-mindmap';
export const inject = ['tools', 'webServer'];
function cwdOfAgent(agent) {
    if (!agent || typeof agent !== 'object')
        return undefined;
    const header = agent.session?.header;
    const cwd = header?.cwd;
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined;
}
/**
 * Phase 4 integration assembly (S4-W1). Every behavior lives in the frozen
 * Phase 2/3 modules; apply() only wires dependencies and optional services.
 */
export function apply(ctx) {
    const locks = new GenerationLockRegistry();
    const panelRuns = new PanelRunRegistry();
    const live = {};
    const capabilities = { jobs: false, subagents: false, fork: false, settings: false, toolCard: true };
    const injectOptional = ctx.inject?.bind(ctx);
    const refreshForkCapability = () => {
        capabilities.subagents = Boolean(live.subagents);
        capabilities.fork = Boolean(live.subagents?.getProvider('fork'));
    };
    injectOptional?.(['agents', 'subagents'], (serviceCtx) => {
        live.agents = serviceCtx.agents;
        live.subagents = serviceCtx.subagents;
        refreshForkCapability();
        serviceCtx.effect(() => () => {
            live.agents = undefined;
            live.subagents = undefined;
            refreshForkCapability();
        }, 'chat-mindmap: fork capability');
    });
    injectOptional?.(['jobs'], (serviceCtx) => {
        live.jobs = serviceCtx.jobs;
        capabilities.jobs = true;
        serviceCtx.effect(() => () => {
            live.jobs = undefined;
            capabilities.jobs = false;
        }, 'chat-mindmap: jobs capability');
    });
    const workspaceKeyOfAgent = (agent) => {
        const cwd = cwdOfAgent(agent);
        return cwd ? workspaceKeyOf(cwd) : undefined;
    };
    const workspaceKeyOfSession = (sessionId) => {
        const agent = live.agents?.get(SessionId(sessionId));
        return workspaceKeyOfAgent(agent);
    };
    // Getters keep the frozen factories live-wired: services attaching after
    // apply() must be visible on the next tool call without re-registration.
    const toolDeps = {
        locks,
        get jobs() {
            return live.jobs;
        },
        get runtime() {
            return live.subagents;
        },
        timeoutMs: GENERATION_TIMEOUT_MS,
        workspaceKeyOfAgent,
    };
    const chatTools = createChatMindmapTools(toolDeps);
    ctx.effect(() => ctx.tools.register(chatTools.generate), 'chat-mindmap: generate_chat_mindmap');
    ctx.effect(() => ctx.tools.register(chatTools.present), 'chat-mindmap: present_chat_mindmap');
    const panelAdapter = createPanelGenerationAdapter({
        locks,
        registry: panelRuns,
        get runtime() {
            return live.subagents;
        },
        promptSourceOf: getMindmap,
        baselineVersionOf: async (libraryId) => (await getMindmap(libraryId))?.recordVersion,
    });
    const startPanelRun = async (request) => {
        const parent = request.sessionId ? live.agents?.get(SessionId(request.sessionId)) : undefined;
        if (!parent)
            throw new DomainError('SESSION_UNAVAILABLE', 'session is not live');
        const runtime = live.subagents;
        if (!runtime || !runtime.getProvider('fork'))
            throw new DomainError('CAPABILITY_UNAVAILABLE', 'fork subagent provider unavailable');
        refreshForkCapability();
        // §11: answer with the runId at once; settlement is observable via the
        // panel-run registry (GET /panel-runs/:id) rather than this response.
        const { view } = panelAdapter.begin({
            libraryId: request.libraryId,
            parent,
            instruction: request.instruction,
            supplementalContext: request.supplementalContext,
            timeoutMs: GENERATION_TIMEOUT_MS,
        });
        return view;
    };
    ctx.effect(() => registerMindmapRoutes({
        webServer: ctx.webServer,
        get agents() {
            return live.agents;
        },
        panelRuns,
        startPanelRun,
        capabilities,
        workspaceKeyOfSession,
    }), 'chat-mindmap: REST V2 routes');
    // §18: plugin unload cancels in-flight panel runs and awaits quiescence;
    // chat job locks release through their own settlement paths.
    ctx.effect(() => () => {
        void panelRuns.disposeAll();
    }, 'chat-mindmap: panel runs dispose');
}
