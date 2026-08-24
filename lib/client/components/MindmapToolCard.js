import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { cardStateOf, CARD_EXPIRED_NOTE } from '../card-state.js';
import { openMindmap } from './mindmap-navigation.js';
// Model-provided markup is never rendered. The durable reference below is the
// only data read from a completed tool result.
const PREVIEW_PREFIX = 'dsh-chat-mindmap-preview:';
export function previewReference(block) {
    if (!('kind' in block))
        return null;
    for (const item of block.content) {
        if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'text' || !('text' in item) || typeof item.text !== 'string')
            continue;
        if (!item.text.startsWith(PREVIEW_PREFIX))
            continue;
        try {
            const value = JSON.parse(item.text.slice(PREVIEW_PREFIX.length));
            if (typeof value.libraryId === 'string' && typeof value.revisionId === 'string' && typeof value.title === 'string' && typeof value.nodeCount === 'number' && (value.state === 'available' || value.state === 'expired'))
                return value;
        }
        catch {
            // A generic tool card remains available for malformed old history.
        }
    }
    return null;
}
export function CardBody(props) {
    const state = cardStateOf(props.reference, 'open-link', props.error);
    const reference = props.reference;
    if (!reference)
        return _jsx("div", { style: { padding: '8px', opacity: 0.7 }, children: state.note });
    if (reference.state === 'expired')
        return _jsx("div", { style: { padding: '8px', opacity: 0.7 }, children: CARD_EXPIRED_NOTE });
    return (_jsxs("section", { style: { padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', maxWidth: '620px' }, children: [_jsx("strong", { children: reference.title }), _jsxs("small", { style: { display: 'block', opacity: 0.7, marginBottom: '8px' }, children: [reference.nodeCount, " \u8282\u70B9 \u00B7 \u5728\u8111\u56FE\u5E93\u4E2D\u7F16\u8F91"] }), reference.capabilityNote ? _jsx("small", { style: { display: 'block', opacity: 0.62, marginBottom: '8px' }, role: 'note', children: reference.capabilityNote }) : null, props.error ? _jsx("span", { role: 'status', style: { display: 'block', marginBottom: '8px' }, children: props.error }) : null, _jsx("button", { type: 'button', style: { padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '6px', cursor: 'pointer' }, "aria-label": '打开 ' + reference.title + ' 脑图', onClick: props.onOpen, children: "\u6253\u5F00\u8111\u56FE" })] }));
}
export function MindmapToolCard({ block, sessionId }) {
    const reference = previewReference(block);
    const [error, setError] = useState(null);
    return _jsx(CardBody, { reference: reference, error: error, onOpen: () => {
            if (!reference || !openMindmap(String(sessionId), reference.libraryId))
                setError('未找到会话的“脑图”标签，请刷新页面后重试');
        } });
}
