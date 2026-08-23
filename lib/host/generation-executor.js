import { buildStrictOutlineDocument, validateAgentOutlineResult } from '../domain/generation.js';
import { mindmapNodeNotesForPrompt, mindmapToMarkdown } from '../core.js';
import { saveMindmap } from '../library.js';
import { DomainError } from '../domain/errors.js';
export function buildRegenerationPrompt(record, instruction) {
    if (!record)
        throw new DomainError('MINDMAP_NOT_FOUND', 'mindmap not found');
    const note = instruction?.trim() || record.config.instruction?.trim() || '';
    const noteSection = note ? `\n\n<panel-note>\n${note}\n</panel-note>` : '';
    const outline = mindmapToMarkdown(record.current.root);
    const contextBudget = Math.max(4_000, Math.floor(record.config.contextLimit || 80_000));
    const framingLength = 1_200 + record.title.length + String(record.config.maxNodes).length;
    const noteBudget = Math.max(0, contextBudget - outline.length - framingLength - note.length);
    const nodeNoteReference = mindmapNodeNotesForPrompt(record.current.root, noteBudget);
    // F-1 (S2 review, closed at the S4 integration switchover): when EVERY node
    // note exceeded the prompt budget the omission hint vanished because the
    // notes array was empty. The zero-attached case now states that explicitly.
    const nodeNoteSection = nodeNoteReference.notes.length
        ? `\n\n<node-notes format="json">\n${JSON.stringify(nodeNoteReference.notes)}\n</node-notes>${nodeNoteReference.omitted ? `\n有 ${nodeNoteReference.omitted} 条过长或超出提示预算的节点备注未附带。` : ''}`
        : nodeNoteReference.omitted
            ? `\n\n注意：本图共 ${nodeNoteReference.omitted} 条节点备注，全部因超出提示预算而未附带；请仅依据脑图大纲本身重建层级。`
            : '';
    return {
        text: `将下面已有脑图转换为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。不要调用工具，不要解释过程，不要编造来源。节点备注是附加参考：应吸收其事实、范围和约束，但绝不能把备注文字当作节点标题逐字输出。\n\n当前标题：${record.title}\n当前脑图 Markdown：\n${outline}${nodeNoteSection}\n\n最多节点：${record.config.maxNodes}${noteSection}\n\n如果没有 panel-note，则保持原主题和层级信息，必要时改善结构。`,
        noteLength: note.length,
    };
}
// ---------------------------------------------------------------------------
// Generation orchestration primitives (S2, docs/plans/S2_PLAN_v3.md).
// The constants below are the canonical copies; frozen duplicates in
// src/index.ts are superseded and get deleted at the integration switchover.
// ---------------------------------------------------------------------------
/** ADR-008: compile-time stability policy. Never exposed as a user setting. */
export const GENERATION_MAX_TOKENS = 6000;
/** §18 hard timeout: 180 seconds ± 2. Inject a short value in tests only. */
export const GENERATION_TIMEOUT_MS = 180_000;
export const OUTLINE_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'outline'],
    properties: { title: { type: 'string' }, outline: { type: 'string' } },
};
export const OUTLINE_PERSONA = '只把给定脑图内容整理为严格 Markdown 层级大纲。不得调用任何工具、技能、子代理或外部服务；不要解释过程。';
/** §8.2 provider ladder: fork → spawn(only with supplemental context) → null. */
export function selectProvider(runtime, supplementalContext) {
    if (!runtime)
        return null;
    if (runtime.getProvider('fork'))
        return 'fork';
    if (runtime.getProvider('spawn') && typeof supplementalContext === 'string' && supplementalContext.trim().length > 0)
        return 'spawn';
    return null;
}
function safeDiagnostic(value) {
    const text = typeof value === 'string' && value.trim().length > 0 ? value : value instanceof Error ? value.message : 'generation failed';
    return text.slice(0, 500);
}
/**
 * Shared §9/§18 control scaffolding for one outline attempt: hard timeout,
 * deterministic classification, and settlement even when the controller was
 * aborted before the runtime attached its own signal handling (DEV-S2-4).
 * The whole attempt races an abort promise, so cancellation wins wherever the
 * attempt is suspended; non-abort errors propagate to the caller.
 */
export async function runWithGenerationControl(opts, attempt) {
    const controller = opts.controller ?? new AbortController();
    // The timeout flag decides classification even when an external abort
    // races it, so timed_out and cancelled never flip-flop.
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, opts.timeoutMs ?? GENERATION_TIMEOUT_MS);
    let abortReject;
    const abortedPromise = new Promise((_resolve, reject) => {
        abortReject = reject;
    });
    abortedPromise.catch(() => undefined);
    const onAbort = () => abortReject(new Error('generation aborted'));
    if (controller.signal.aborted)
        onAbort();
    else
        controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
        const raced = await Promise.race([attempt({ signal: controller.signal, timedOut: () => timedOut }), abortedPromise]);
        if (controller.signal.aborted)
            return { settled: false, kind: timedOut ? 'timed_out' : 'cancelled' };
        return { settled: true, value: raced };
    }
    catch (error) {
        if (controller.signal.aborted)
            return { settled: false, kind: timedOut ? 'timed_out' : 'cancelled' };
        throw error;
    }
    finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', onAbort);
    }
}
/**
 * Runs one regeneration outline attempt (panel flavor): the prompt is always
 * composed by buildRegenerationPrompt (P3 single copy); the result must pass
 * the strict outline pipeline (§8.4). Runtime outcome problems are returned
 * as values, never thrown, so callers can map them to terminal run states
 * deterministically.
 */
export async function runOutlineGeneration(services, input, opts = {}) {
    const provider = selectProvider(services.runtime, input.supplementalContext);
    if (!provider)
        throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable');
    const { text } = buildRegenerationPrompt(input.record, input.instruction);
    let disposed = false;
    let run;
    const disposeOnce = async () => {
        if (disposed || !run)
            return;
        disposed = true;
        try {
            await run.dispose();
        }
        catch {
            // R9: rc8 dispose idempotency is unverified; swallow cleanup errors.
        }
    };
    try {
        const outcome = await runWithGenerationControl(opts, async (ctx) => {
            run = await services.runtime.start(provider, {
                label: input.label ?? '重新构建脑图',
                prompt: [{ type: 'text', text }],
                parent: input.parent,
                signal: ctx.signal,
                outputSchema: OUTLINE_OUTPUT_SCHEMA,
                maxDepth: 1,
                toolFilter: { allow: [] },
                persona: OUTLINE_PERSONA,
            });
            return await run.result;
        });
        if (!outcome.settled)
            return outcome.kind === 'timed_out' ? { kind: 'timed_out', diagnostic: 'generation timed out' } : { kind: 'cancelled' };
        const result = outcome.value;
        if (result.stopReason !== 'completed')
            return { kind: 'failed', diagnostic: safeDiagnostic(result.diagnostic || ('subagent stopped: ' + result.stopReason)) };
        const validated = validateAgentOutlineResult(result.structured);
        const strict = buildStrictOutlineDocument(validated, { maxNodes: input.record.config.maxNodes, contextLimit: input.record.config.contextLimit });
        return { kind: 'completed', document: strict.document, title: strict.document.title, truncated: strict.truncated, childId: run.id, provider };
    }
    catch (error) {
        return { kind: 'failed', diagnostic: safeDiagnostic(error) };
    }
    finally {
        await disposeOnce();
    }
}
/**
 * Chat-source prompt composition (§10.1/§8.3): the chat entry always turns
 * SOURCE MATERIAL into an outline. Fork additionally inherits completed
 * conversation turns; the current-turn increment travels as the context
 * material below. Single canonical copy lives here (§4.1).
 */
export function buildSourceOutlinePrompt(input) {
    const context = typeof input.context === 'string' ? input.context.trim() : '';
    const material = context.length > 0
        ? '<source-material>\n' + context + '\n</source-material>'
        : '<source-material>当前会话已完成回合中的相关内容（不含本回合；附件原文不在此列）。</source-material>';
    const requestedTitle = input.title && input.title.trim().length > 0
        ? '- 根标题建议：' + input.title.trim() + '（若与材料主题冲突，以材料为准）'
        : '- 根标题：从材料中提炼简洁主题';
    const instructionLine = input.instruction && input.instruction.trim().length > 0 ? '\n- 附加要求：' + input.instruction.trim() : '';
    return [
        '将下面来源材料整理为结构清晰、可编辑的 Markdown 层级大纲。只输出符合 schema 的 title 和 outline。',
        '不要调用任何工具、技能或子代理；不要解释过程；不得编造材料中不存在的内容。',
        '',
        material,
        '',
        '约束：',
        '- 来源边界：仅使用上述材料，不得引入材料之外的事实（来源类型：' + (input.sourceKind ?? 'chat') + '）。',
        '- 最多节点：' + input.config.maxNodes,
        '- 密度：' + input.config.density,
        '- 语言：' + input.config.language,
        requestedTitle + instructionLine,
    ].join('\n');
}
/**
 * Chat-flavor outline runner (§10.1): source material → strict outline via
 * the same provider ladder, schema, persona, tool filter and §9 control
 * scaffolding as the panel runner. DomainErrors from validation propagate so
 * callers can surface stable error codes; runtime-level problems still come
 * back as values.
 */
export async function runSourceOutlineGeneration(services, input, opts = {}) {
    const provider = selectProvider(services.runtime, input.context);
    if (!provider)
        throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable');
    const text = buildSourceOutlinePrompt({ context: input.context, title: input.title, instruction: input.instruction, sourceKind: input.sourceKind, config: input.config });
    let disposed = false;
    let run;
    const disposeOnce = async () => {
        if (disposed || !run)
            return;
        disposed = true;
        try {
            await run.dispose();
        }
        catch {
            // R9: rc8 dispose idempotency is unverified; swallow cleanup errors.
        }
    };
    try {
        const outcome = await runWithGenerationControl(opts, async (ctx) => {
            run = await services.runtime.start(provider, {
                label: input.label ?? (input.title ? '生成脑图：' + input.title : '生成脑图'),
                prompt: [{ type: 'text', text }],
                parent: input.parent,
                signal: ctx.signal,
                outputSchema: OUTLINE_OUTPUT_SCHEMA,
                maxDepth: 1,
                toolFilter: { allow: [] },
                persona: OUTLINE_PERSONA,
            });
            return await run.result;
        });
        if (!outcome.settled)
            return outcome.kind === 'timed_out' ? { kind: 'timed_out', diagnostic: 'generation timed out' } : { kind: 'cancelled' };
        const result = outcome.value;
        if (result.stopReason !== 'completed')
            return { kind: 'failed', diagnostic: safeDiagnostic(result.diagnostic || ('subagent stopped: ' + result.stopReason)) };
        const validated = validateAgentOutlineResult(result.structured);
        const strict = buildStrictOutlineDocument(validated, { maxNodes: input.config.maxNodes, contextLimit: input.config.contextLimit });
        return { kind: 'completed', document: strict.document, title: strict.document.title, truncated: strict.truncated, childId: run.id, provider };
    }
    catch (error) {
        if (error instanceof DomainError)
            throw error;
        return { kind: 'failed', diagnostic: safeDiagnostic(error) };
    }
    finally {
        await disposeOnce();
    }
}
/**
 * §9.1 commit boundary: the fully constructed record is persisted through the
 * library's compare-and-swap in one atomic write, and the completed outcome is
 * only returned after the save resolved — "completed ⇒ record readable".
 * Absent baselines (pre-allocated fresh maps) rely on the generation lock and
 * omit expectedRecordVersion; see risk R11.
 */
export async function commitGenerationOutcome(input, deps = {}) {
    const save = deps.save ?? saveMindmap;
    return save({
        libraryId: input.libraryId,
        title: input.title,
        document: input.document,
        config: input.config,
        ...(input.source ? { source: input.source } : {}),
        rotatePrevious: true,
        ...(typeof input.baselineRecordVersion === 'number' ? { expectedRecordVersion: input.baselineRecordVersion } : {}),
    });
}
