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
