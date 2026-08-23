import { buildStrictOutlineDocument, validateAgentOutlineResult } from '../domain/generation.js';
import { mindmapNodeNotesForPrompt, mindmapToMarkdown } from '../core.js';
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
    const nodeNoteSection = nodeNoteReference.notes.length
        ? `\n\n<node-notes format="json">\n${JSON.stringify(nodeNoteReference.notes)}\n</node-notes>${nodeNoteReference.omitted ? `\n有 ${nodeNoteReference.omitted} 条过长或超出提示预算的节点备注未附带。` : ''}`
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
 * Runs one subagent outline attempt. Provider selection follows §8.2; the
 * prompt is always composed by buildRegenerationPrompt (P3 single copy); the
 * result must pass the strict outline pipeline (§8.4). Runtime outcome
 * problems are returned as values, never thrown, so callers can map them to
 * terminal run states deterministically.
 */
export async function runOutlineGeneration(services, input) {
    const provider = selectProvider(services.runtime, input.supplementalContext);
    if (!provider)
        throw new DomainError('CAPABILITY_UNAVAILABLE', 'generation providers unavailable');
    const controller = input.controller ?? new AbortController();
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
        run = await services.runtime.start(provider, {
            label: input.label ?? '重新构建脑图',
            prompt: [{ type: 'text', text }],
            parent: input.parent,
            signal: controller.signal,
            outputSchema: OUTLINE_OUTPUT_SCHEMA,
            maxDepth: 1,
            toolFilter: { allow: [] },
            persona: OUTLINE_PERSONA,
        });
        const result = await run.result;
        if (result.stopReason !== 'completed')
            return { kind: 'failed', diagnostic: safeDiagnostic(result.diagnostic || `subagent stopped: ${result.stopReason}`) };
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
