import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
const PLUGIN_ID = '@dsh-external/dsh-chat-mindmap';
const API_BASE = '/@dsh-external/dsh-chat-mindmap';
export const inject = ['slots', 'sessions'];
const LAYOUT_OPTIONS = [
    ['logicalStructure', '逻辑结构图'],
    ['logicalStructureLeft', '向左逻辑结构图'],
    ['mindMap', '思维导图'],
    ['organizationStructure', '组织结构图'],
    ['catalogOrganization', '目录组织图'],
    ['timeline', '时间轴'],
    ['timeline2', '时间轴 2'],
    ['verticalTimeline', '竖向时间轴'],
    ['verticalTimeline2', '竖向时间轴 2'],
    ['verticalTimeline3', '竖向时间轴 3'],
    ['fishbone', '鱼骨图'],
    ['fishbone2', '鱼骨图 2'],
    ['rightFishbone', '向右鱼骨图'],
    ['rightFishbone2', '向右鱼骨图 2'],
];
const THEME_PRESETS = {
    default: { label: '默认青绿', config: {} },
    classic4: { label: 'Classic 4（经典）', config: { backgroundColor: '#fffdf5', lineColor: '#8b7355', generalizationLineColor: '#8b7355', root: { fillColor: '#8b7355', color: '#fff', borderColor: '#6f5a43' }, second: { fillColor: '#f5ead7', color: '#4a3828', borderColor: '#c9a66b' }, node: { color: '#5c4632', borderColor: 'transparent' } } },
    ocean: { label: '海洋蓝', config: { backgroundColor: '#eff6ff', lineColor: '#2563eb', generalizationLineColor: '#2563eb', root: { fillColor: '#1d4ed8', color: '#fff', borderColor: '#1e40af' }, second: { fillColor: '#dbeafe', color: '#1e3a8a', borderColor: '#60a5fa' }, node: { color: '#1e3a8a', borderColor: 'transparent' } } },
    forest: { label: '森林绿', config: { backgroundColor: '#f0fdf4', lineColor: '#15803d', generalizationLineColor: '#15803d', root: { fillColor: '#166534', color: '#fff', borderColor: '#14532d' }, second: { fillColor: '#dcfce7', color: '#14532d', borderColor: '#4ade80' }, node: { color: '#166534', borderColor: 'transparent' } } },
    sunset: { label: '日落橙', config: { backgroundColor: '#fff7ed', lineColor: '#ea580c', generalizationLineColor: '#ea580c', root: { fillColor: '#c2410c', color: '#fff', borderColor: '#9a3412' }, second: { fillColor: '#ffedd5', color: '#7c2d12', borderColor: '#fb923c' }, node: { color: '#9a3412', borderColor: 'transparent' } } },
    lavender: { label: '薰衣草紫', config: { backgroundColor: '#faf5ff', lineColor: '#9333ea', generalizationLineColor: '#9333ea', root: { fillColor: '#7e22ce', color: '#fff', borderColor: '#6b21a8' }, second: { fillColor: '#f3e8ff', color: '#581c87', borderColor: '#c084fc' }, node: { color: '#6b21a8', borderColor: 'transparent' } } },
    graphite: { label: '石墨灰', config: { backgroundColor: '#f8fafc', lineColor: '#475569', generalizationLineColor: '#475569', root: { fillColor: '#334155', color: '#fff', borderColor: '#1e293b' }, second: { fillColor: '#e2e8f0', color: '#1e293b', borderColor: '#94a3b8' }, node: { color: '#334155', borderColor: 'transparent' } } },
    rose: { label: '玫瑰红', config: { backgroundColor: '#fff1f2', lineColor: '#e11d48', generalizationLineColor: '#e11d48', root: { fillColor: '#be123c', color: '#fff', borderColor: '#9f1239' }, second: { fillColor: '#ffe4e6', color: '#881337', borderColor: '#fb7185' }, node: { color: '#9f1239', borderColor: 'transparent' } } },
    amber: { label: '琥珀金', config: { backgroundColor: '#fffbeb', lineColor: '#d97706', generalizationLineColor: '#d97706', root: { fillColor: '#b45309', color: '#fff', borderColor: '#92400e' }, second: { fillColor: '#fef3c7', color: '#78350f', borderColor: '#fbbf24' }, node: { color: '#92400e', borderColor: 'transparent' } } },
    contrast: { label: '高对比黑白', config: { backgroundColor: '#fff', lineColor: '#111827', generalizationLineColor: '#111827', root: { fillColor: '#111827', color: '#fff', borderColor: '#000' }, second: { fillColor: '#fff', color: '#111827', borderColor: '#111827' }, node: { color: '#111827', borderColor: 'transparent' } } },
};
function themePreset(theme) { return THEME_PRESETS[theme] ?? THEME_PRESETS.default; }
function shellIsDark() {
    if (typeof window === 'undefined')
        return false;
    const root = window.document.documentElement;
    if (/dark|night/i.test(`${root.className} ${root.getAttribute('data-theme') ?? ''}`))
        return true;
    const color = window.getComputedStyle(window.document.body).backgroundColor;
    const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
    if (channels?.length === 3)
        return (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) < 128;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}
function shellThemeConfig(theme, dark) {
    if (theme !== 'default')
        return themePreset(theme);
    return dark
        ? { label: '默认青绿（夜间）', config: { backgroundColor: '#24262c', lineColor: '#5eead4', generalizationLineColor: '#5eead4', root: { fillColor: '#0f766e', color: '#f8fafc', borderColor: '#2dd4bf' }, second: { fillColor: '#30333a', color: '#f8fafc', borderColor: '#5eead4' }, node: { color: '#e5e7eb', borderColor: 'transparent' } } }
        : { label: '默认青绿（日间）', config: { backgroundColor: '#f9fafb', lineColor: '#0f766e', generalizationLineColor: '#0f766e', root: { fillColor: '#0f766e', color: '#fff', borderColor: '#0d5f59' }, second: { fillColor: '#ecfdf5', color: '#134e4a', borderColor: '#5eead4' }, node: { color: '#1f2937', borderColor: 'transparent' } } };
}
async function api(path, init) {
    const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'x-dsh-chat-mindmap-request': '1', ...(init?.headers ?? {}) } });
    const payload = await response.json();
    if (!response.ok || !payload.ok || payload.value === undefined)
        throw new Error(payload.error ?? '脑图服务请求失败');
    return payload.value;
}
const DEFAULT_RENDER_COLLAPSE_DEPTH = 2;
function toRenderNode(node, depth) {
    const hasChildren = (node.children?.length ?? 0) > 0;
    // Always collapse deeper branches in the render-only copy. Persisted expand
    // state must not force a full expensive first layout after map switching.
    const collapseForInitialRender = depth >= DEFAULT_RENDER_COLLAPSE_DEPTH && hasChildren;
    return { ...node, ...(collapseForInitialRender ? { collapsed: true } : {}), children: node.children?.map((child) => toRenderNode(child, depth + 1)) };
}
function toSimpleMindMapData(node) { return { data: { text: node.title, id: node.id, ...(node.note ? { note: node.note } : {}), ...(node.collapsed ? { expand: false } : {}) }, children: (node.children ?? []).map(toSimpleMindMapData) }; }
function fromSimpleMindMapNode(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const value = raw;
    const title = typeof value.data?.text === 'string' ? value.data.text : '';
    if (!title)
        return null;
    return { id: typeof value.id === 'string' ? value.id : typeof value.data?.id === 'string' ? value.data.id : `node-${Math.random().toString(36).slice(2)}`, title, ...(typeof value.data?.note === 'string' ? { note: value.data.note } : {}), ...(typeof value.data?.expand === 'boolean' ? { collapsed: value.data.expand === false } : {}), children: (value.children ?? []).map(fromSimpleMindMapNode).filter((child) => child !== null) };
}
function markdown(node, depth = 0) { return [`${'#'.repeat(Math.min(depth + 1, 6))} ${node.title}`, ...(node.children ?? []).map((child) => markdown(child, depth + 1))].join('\n'); }
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function safeFilename(title, extension) { return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'mindmap'}.${extension}`; }
function svgPreviewHtml(svgUrl, title) {
    const escapedTitle = title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    const encodedUrl = JSON.stringify(svgUrl).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle} · SVG 预览</title><style>html,body{margin:0;min-height:100%;background:#0f172a}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}img{display:block;max-width:100%;max-height:calc(100vh - 32px);background:#fff;border-radius:8px}</style></head><body><img src="${svgUrl}" alt="${escapedTitle} 思维导图"><script>window.addEventListener('beforeunload',()=>URL.revokeObjectURL(${encodedUrl}))</script></body></html>`;
}
function asBlob(value) {
    if (value instanceof Blob)
        return value;
    if (typeof value !== 'string' || !value.startsWith('data:'))
        return null;
    const comma = value.indexOf(',');
    if (comma < 0)
        return null;
    const meta = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    const mime = meta.slice(5).split(';')[0] || 'application/octet-stream';
    try {
        if (meta.endsWith(';base64'))
            return new Blob([Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))], { type: mime });
        return new Blob([decodeURIComponent(payload)], { type: mime });
    }
    catch {
        return null;
    }
}
async function loadMindMap() { const module = await import('./mindmap.js'); return module.default; }
function panelStyle() { return { display: 'flex', flexDirection: 'column', width: '100%', minWidth: '0', height: '100%', minHeight: '0', flex: '1 1 0', overflow: 'hidden', padding: '0', background: 'var(--dsw-alias-bg-base,#f7f8fa)', color: 'var(--dsw-alias-label-primary,#202124)', font: '13px/1.45 system-ui,sans-serif' }; }
function buttonStyle() { return { border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'inherit', borderRadius: '4px', padding: '5px 8px', cursor: 'pointer' }; }
function inputStyle() { return { display: 'block', width: '100%', boxSizing: 'border-box', padding: '7px', borderRadius: '4px', border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-bg-base,#fff)', color: 'inherit' }; }
function zoomButtonStyle() { return { border: '0', background: 'transparent', color: 'inherit', borderRadius: '4px', minWidth: '28px', padding: '4px 5px', cursor: 'pointer', font: 'inherit' }; }
function nextPaint() { return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))); }
function MapCanvas({ record, onDocumentChange, onXmind, onActions, onFullscreenChange, onNodeSelect }) {
    const canvasRef = useRef(null);
    const fullscreenRef = useRef(null);
    // SimpleMindMap creates its contenteditable element outside the SVG. Keep it
    // inside this canvas, which remains within the fullscreen element.
    const mapRef = useRef(null);
    const saveTimer = useRef(null);
    const resizeRaf = useRef(null);
    const recordRef = useRef(record);
    const [fullscreen, setFullscreen] = useState(false);
    const [fullscreenNode, setFullscreenNode] = useState(null);
    const [shellDark, setShellDark] = useState(shellIsDark);
    const [renderState, setRenderState] = useState('loading');
    const renderKey = `${record.libraryId}:${record.current.source.generatedAt}`;
    const canvasFullscreen = () => window.document.fullscreenElement === fullscreenRef.current;
    const runCanvasTask = async (task) => {
        setRenderState('loading');
        await nextPaint();
        if (!mapRef.current)
            return;
        try {
            task();
            // SimpleMindMap schedules the SVG update synchronously/asynchronously
            // depending on its layout. Keep the canvas-only blocker until the browser
            // has had a full post-command paint opportunity, not just until command return.
            await nextPaint();
        }
        finally {
            if (mapRef.current)
                setRenderState('ready');
        }
    };
    useEffect(() => { recordRef.current = record; }, [record]);
    useEffect(() => {
        const sync = () => setShellDark(shellIsDark());
        const observer = new MutationObserver(sync);
        observer.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', sync);
        sync();
        return () => { observer.disconnect(); window.matchMedia?.('(prefers-color-scheme: dark)').removeEventListener?.('change', sync); };
    }, []);
    useEffect(() => {
        const changed = () => { const active = canvasFullscreen(); setFullscreen(active); onFullscreenChange(active); window.setTimeout(() => mapRef.current?.resize(), 0); };
        window.document.addEventListener('fullscreenchange', changed);
        return () => window.document.removeEventListener('fullscreenchange', changed);
    }, [onFullscreenChange]);
    useEffect(() => {
        const viewport = fullscreenRef.current;
        if (!viewport)
            return;
        let lastSize = '';
        let resizeListener = null;
        const scheduleResize = (width, height) => {
            // Observe only the host viewport. Renderer-owned DOM must never feed
            // its own size back into the layout and create an expansion loop.
            if (width < 1 || height < 1)
                return;
            const size = `${Math.round(width)}x${Math.round(height)}`;
            if (lastSize === size)
                return;
            lastSize = size;
            if (resizeRaf.current !== null)
                window.cancelAnimationFrame(resizeRaf.current);
            resizeRaf.current = window.requestAnimationFrame(() => {
                resizeRaf.current = null;
                mapRef.current?.resize();
            });
        };
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry)
                scheduleResize(entry.contentRect.width, entry.contentRect.height);
        });
        observer?.observe(viewport);
        resizeListener = () => scheduleResize(viewport.clientWidth, viewport.clientHeight);
        window.addEventListener('resize', resizeListener);
        resizeListener();
        return () => {
            observer?.disconnect();
            if (resizeListener)
                window.removeEventListener('resize', resizeListener);
            if (resizeRaf.current !== null)
                window.cancelAnimationFrame(resizeRaf.current);
            resizeRaf.current = null;
        };
    }, []);
    useEffect(() => {
        let alive = true;
        const canvas = canvasRef.current;
        if (!canvas)
            return () => { alive = false; };
        canvas.replaceChildren();
        setRenderState('loading');
        void (async () => {
            try {
                await nextPaint();
                const MindMap = await loadMindMap();
                if (!alive || !canvasRef.current)
                    return;
                const sourceRoot = recordRef.current.current.root;
                const renderRoot = toRenderNode(sourceRoot, 0);
                const instance = new MindMap({ el: canvasRef.current, data: toSimpleMindMapData(renderRoot), layout: recordRef.current.config.layout, theme: 'default', themeConfig: shellThemeConfig(recordRef.current.config.theme, shellDark).config, fit: true, customInnerElsAppendTo: canvasRef.current });
                mapRef.current = instance;
                onActions({
                    undo: () => runCanvasTask(() => instance.execCommand?.('BACK')),
                    redo: () => runCanvasTask(() => instance.execCommand?.('FORWARD')),
                    expandAll: () => runCanvasTask(() => instance.execCommand?.('EXPAND_ALL')),
                    collapseAll: () => runCanvasTask(() => instance.execCommand?.('UNEXPAND_ALL')),
                    collapseToLevel: (level) => runCanvasTask(() => instance.execCommand?.('UNEXPAND_TO_LEVEL', level)),
                    exportPng: async () => {
                        const value = await instance.doExport?.export('png', false, recordRef.current.title, false, null, true);
                        const blob = asBlob(value);
                        if (!blob || blob.type !== 'image/png')
                            throw new Error('PNG 导出失败');
                        downloadBlob(blob, safeFilename(recordRef.current.title, 'png'));
                    },
                    openSvgPreview: async () => {
                        // Open synchronously from the button click so browser popup protection does not reject the preview.
                        const preview = window.open('', '_blank');
                        if (!preview)
                            throw new Error('浏览器阻止了新标签页，请允许弹窗后重试');
                        preview.opener = null;
                        const value = await instance.doExport?.export('svg', false, recordRef.current.title);
                        const blob = asBlob(value);
                        if (!blob || blob.type !== 'image/svg+xml') {
                            preview.close();
                            throw new Error('SVG 导出失败');
                        }
                        const svgUrl = URL.createObjectURL(blob);
                        preview.document.open();
                        preview.document.write(svgPreviewHtml(svgUrl, recordRef.current.title));
                        preview.document.close();
                    },
                    toggleFullscreen: async () => {
                        const canvas = fullscreenRef.current;
                        if (!canvas)
                            throw new Error('画布尚未准备完成');
                        if (canvasFullscreen()) {
                            if (window.document.exitFullscreen)
                                await window.document.exitFullscreen();
                            return;
                        }
                        if (!canvas.requestFullscreen)
                            throw new Error('当前浏览器不支持全屏画布');
                        await canvas.requestFullscreen();
                    },
                    isFullscreen: canvasFullscreen,
                    zoomIn: () => instance.view?.enlarge(),
                    zoomOut: () => instance.view?.narrow(),
                    saveNode: (node) => {
                        const active = instance.renderer?.activeNodeList?.find((item) => item.getData?.('id') === node.id);
                        if (!active)
                            return;
                        instance.execCommand?.('SET_NODE_TEXT', active, node.title);
                        instance.execCommand?.('SET_NODE_NOTE', active, node.note);
                        setFullscreenNode(node);
                    },
                });
                const changed = () => {
                    const raw = instance.getData?.(false);
                    const root = fromSimpleMindMapNode(raw?.root ?? raw);
                    if (root) {
                        if (saveTimer.current !== null)
                            window.clearTimeout(saveTimer.current);
                        const next = { ...recordRef.current.current, root };
                        saveTimer.current = window.setTimeout(() => onDocumentChange(next), 700);
                    }
                };
                const selected = (raw) => {
                    const node = raw;
                    const id = node?.getData?.('id');
                    const title = node?.getData?.('text');
                    if (typeof id !== 'string' || typeof title !== 'string') {
                        onNodeSelect(null);
                        setFullscreenNode(null);
                        return;
                    }
                    const note = node?.getData?.('note');
                    const next = { id, title, note: typeof note === 'string' ? note : '' };
                    onNodeSelect(next);
                    if (canvasFullscreen())
                        setFullscreenNode(next);
                };
                const clearSelected = () => { onNodeSelect(null); setFullscreenNode(null); };
                instance.on?.('node_active', selected);
                instance.on?.('draw_click', clearSelected);
                instance.on?.('data_change', changed);
                window.setTimeout(() => instance.resize(), 0);
                const applyAppearance = () => {
                    instance.setThemeConfig?.(shellThemeConfig(recordRef.current.config.theme, shellDark).config);
                    instance.setLayout?.(recordRef.current.config.layout);
                    instance.resize();
                };
                applyAppearance();
                if (instance.doExport)
                    void instance.doExport.export('xmind', false, recordRef.current.title, instance.getData?.(false)).then((value) => { if (alive)
                        onXmind(asBlob(value)); }).catch(() => onXmind(null));
                const cleanup = () => { instance.off?.('data_change', changed); instance.off?.('node_active', selected); instance.off?.('draw_click', clearSelected); };
                instance.__cleanup = cleanup;
                await nextPaint();
                if (alive)
                    setRenderState('ready');
            }
            catch {
                if (alive) {
                    onXmind(null);
                    setRenderState('failed');
                }
            }
        })();
        return () => { alive = false; onActions(null); if (saveTimer.current !== null)
            window.clearTimeout(saveTimer.current); const inst = mapRef.current; inst?.__cleanup?.(); mapRef.current?.destroy?.(); mapRef.current = null; canvas.replaceChildren(); };
    }, [renderKey]);
    useEffect(() => {
        const instance = mapRef.current;
        if (!instance)
            return;
        instance.setThemeConfig?.(shellThemeConfig(record.config.theme, shellDark).config);
        instance.setLayout?.(record.config.layout);
        instance.reRender?.(() => instance.resize(), 'chat-mindmap: appearance-change');
        if (!instance.reRender) {
            instance.render?.(() => instance.resize(), 'chat-mindmap: appearance-change');
        }
    }, [record.config.layout, record.config.theme, shellDark]);
    return createElement('div', { ref: fullscreenRef, 'aria-busy': renderState === 'loading', style: { position: 'relative', width: '100%', minWidth: 0, minHeight: 0, flex: '1 1 0', borderRadius: '4px', overflow: 'hidden', background: shellDark ? '#24262c' : '#f9fafb' } }, createElement('style', null, '@keyframes dsh-chat-mindmap-spin { to { transform: rotate(360deg); } }'), fullscreen ? createElement('div', { style: { position: 'absolute', top: '12px', left: '12px', right: '12px', zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'none' } }, createElement('span', { style: { padding: '5px 8px', borderRadius: '4px', background: 'rgba(15,23,42,.84)', color: '#e2e8f0', pointerEvents: 'auto' } }, '全屏编辑：双击节点直接改名，或使用右侧节点属性'), createElement('button', { type: 'button', onClick: () => void window.document.exitFullscreen?.(), style: { marginLeft: 'auto', zIndex: 5, pointerEvents: 'auto', ...buttonStyle() }, 'aria-label': '退出全屏画布' }, '退出全屏')) : null, createElement('div', { ref: canvasRef, style: { position: 'absolute', inset: 0, minWidth: 0, minHeight: 0 } }), fullscreen && fullscreenNode ? createElement('form', { onSubmit: (event) => { event.preventDefault(); const title = fullscreenNode.title.trim(); if (!title)
            return; const active = mapRef.current?.renderer?.activeNodeList?.find((item) => item.getData?.('id') === fullscreenNode.id); if (!active)
            return; mapRef.current?.execCommand?.('SET_NODE_TEXT', active, title); mapRef.current?.execCommand?.('SET_NODE_NOTE', active, fullscreenNode.note); setFullscreenNode({ ...fullscreenNode, title }); }, style: { position: 'absolute', top: '58px', right: '12px', zIndex: 4, display: 'grid', gap: '7px', width: 'min(320px, calc(100vw - 32px))', padding: '12px', border: '1px solid rgba(148,163,184,.7)', borderRadius: '8px', background: 'rgba(15,23,42,.94)', color: '#e2e8f0', boxShadow: '0 12px 30px rgba(0,0,0,.36)' } }, createElement('strong', null, '节点属性'), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', null, '标题'), createElement('input', { value: fullscreenNode.title, onChange: (event) => setFullscreenNode({ ...fullscreenNode, title: event.target.value }), style: { ...inputStyle(), background: '#fff', color: '#111827' }, 'aria-label': '全屏节点标题' })), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', null, '备注'), createElement('textarea', { rows: 4, value: fullscreenNode.note, onChange: (event) => setFullscreenNode({ ...fullscreenNode, note: event.target.value }), style: { ...inputStyle(), background: '#fff', color: '#111827', resize: 'vertical' }, 'aria-label': '全屏节点备注' })), createElement('div', { style: { display: 'flex', gap: '6px' } }, createElement('button', { type: 'submit', style: { ...buttonStyle(), background: '#14b8a6', borderColor: '#14b8a6', color: '#fff' } }, '保存节点'), createElement('button', { type: 'button', onClick: () => setFullscreenNode(null), style: buttonStyle() }, '收起'))) : null, renderState !== 'ready' ? createElement('div', { role: renderState === 'failed' ? 'alert' : 'status', 'aria-live': 'polite', style: { position: 'absolute', inset: 0, zIndex: 2, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.78)', color: '#e2e8f0', backdropFilter: 'blur(2px)', pointerEvents: 'auto' } }, renderState === 'loading' ? createElement('div', { style: { display: 'grid', justifyItems: 'center', gap: '12px', textAlign: 'center' } }, createElement('span', { 'aria-hidden': true, style: { width: '32px', height: '32px', border: '3px solid rgba(94,234,212,.28)', borderTopColor: '#5eead4', borderRadius: '50%', animation: 'dsh-chat-mindmap-spin .8s linear infinite' } }), createElement('strong', null, '正在渲染脑图…'), createElement('small', null, '高节点数脑图仅阻塞此画布，不影响其他操作')) : createElement('div', { style: { textAlign: 'center' } }, createElement('strong', null, '脑图渲染失败'), createElement('small', { style: { display: 'block', marginTop: '6px' } }, '请切换其他脑图后重试'))) : null);
}
function previewReference(block) {
    if (!('kind' in block))
        return null;
    for (const item of block.content) {
        if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'text' || !('text' in item) || typeof item.text !== 'string')
            continue;
        const prefix = 'dsh-chat-mindmap-preview:';
        if (!item.text.startsWith(prefix))
            continue;
        try {
            const value = JSON.parse(item.text.slice(prefix.length));
            if (typeof value.libraryId === 'string' && typeof value.revisionId === 'string' && typeof value.title === 'string' && typeof value.nodeCount === 'number' && (value.state === 'available' || value.state === 'expired'))
                return value;
        }
        catch { /* A generic tool card remains available for malformed old history. */ }
    }
    return null;
}
async function svgPreview(mindmap, config) {
    const host = window.document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1200px;height:800px;pointer-events:none;';
    window.document.body.append(host);
    let instance = null;
    try {
        const MindMap = await loadMindMap();
        instance = new MindMap({ el: host, data: toSimpleMindMapData(mindmap.root), layout: config.layout, theme: 'default', themeConfig: themePreset(config.theme).config, fit: true });
        await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
        const value = await instance.doExport?.export('svg', false, mindmap.title, instance.getData?.(false));
        const blob = asBlob(value);
        if (!blob || blob.type !== 'image/svg+xml')
            throw new Error('SVG preview export failed');
        return URL.createObjectURL(blob);
    }
    finally {
        instance?.destroy?.();
        host.remove();
    }
}
function MindmapToolCard({ block }) {
    const reference = previewReference(block);
    const [url, setUrl] = useState(null);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(false);
    useEffect(() => {
        let alive = true;
        let objectUrl = null;
        setUrl(null);
        setError(null);
        setOpen(false);
        if (!reference || reference.state === 'expired')
            return () => undefined;
        void api(`/maps/${encodeURIComponent(reference.libraryId)}/revisions/${encodeURIComponent(reference.revisionId)}`).then(async (preview) => {
            const nextUrl = await svgPreview(preview.document, preview.config);
            if (alive) {
                objectUrl = nextUrl;
                setUrl(nextUrl);
            }
            else {
                URL.revokeObjectURL(nextUrl);
            }
        }).catch(() => { if (alive)
            setError('脑图预览已失效或无法生成'); });
        return () => { alive = false; if (objectUrl)
            URL.revokeObjectURL(objectUrl); };
    }, [reference?.libraryId, reference?.revisionId, reference?.state]);
    if (!reference)
        return createElement('div', { style: { padding: '8px', opacity: .7 } }, '脑图预览数据不可用');
    if (reference.state === 'expired')
        return createElement('div', { style: { padding: '8px', opacity: .7 } }, '本图已失效');
    return createElement('section', { style: { padding: '10px', border: '1px solid var(--dsw-alias-border-l2,#475569)', borderRadius: '8px', maxWidth: '620px' } }, createElement('strong', null, reference.title), createElement('small', { style: { display: 'block', opacity: .7, marginBottom: '8px' } }, `${reference.nodeCount} 节点 · SVG 预览`), reference.capabilityNote ? createElement('small', { style: { display: 'block', opacity: .62, marginBottom: '8px' }, role: 'note' }, reference.capabilityNote) : null, error ? createElement('span', { role: 'status' }, error) : url ? createElement('button', { type: 'button', onClick: () => setOpen(true), style: { display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }, 'aria-label': `打开 ${reference.title} SVG 预览` }, createElement('img', { src: url, alt: `${reference.title} 思维导图`, style: { display: 'block', maxWidth: '100%', maxHeight: '360px', background: 'var(--dsw-alias-bg-base,#fff)', borderRadius: '6px' } })) : createElement('span', { role: 'status' }, '正在生成 SVG 预览…'), open && url ? createElement(SvgPreviewDialog, { src: url, alt: `${reference.title} 思维导图`, onClose: () => setOpen(false) }) : null);
}
/**
 * rc.8 intentionally does not export the attachment package's internal
 * ImageLightbox. Keep previewing functional through the platform dialog
 * primitive instead of importing an unsupported private source path.
 */
function SvgPreviewDialog({ src, alt, onClose }) {
    const closeRef = useRef(null);
    const restoreFocusRef = useRef(null);
    useEffect(() => {
        restoreFocusRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
        closeRef.current?.focus();
        const onKeyDown = (event) => { if (event.key === 'Escape')
            onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); restoreFocusRef.current?.focus(); };
    }, [onClose]);
    return createPortal(createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': '脑图 SVG 预览', style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center' } }, createElement('button', { type: 'button', 'aria-label': '关闭预览', onClick: onClose, style: { position: 'absolute', inset: 0, border: 0, background: 'rgba(2,6,23,.78)', cursor: 'default' } }), createElement('section', { style: { position: 'relative', zIndex: 1, maxWidth: '92vw', maxHeight: '92vh', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', borderRadius: '10px' } }, createElement('img', { src, alt, style: { display: 'block', maxWidth: '88vw', maxHeight: '82vh', background: 'var(--dsw-alias-bg-base,#fff)' } }), createElement('button', { ref: closeRef, type: 'button', onClick: onClose, style: { ...buttonStyle(), marginTop: '8px' } }, '关闭预览'))), window.document.body);
}
function BrainmapView(props) {
    const sessionId = props.sessionId;
    const [maps, setMaps] = useState([]);
    const [selectedId, setSelectedId] = useState();
    const [record, setRecord] = useState(null);
    const [galleryState, setGalleryState] = useState('loading');
    const [status, setStatus] = useState('正在打开脑图库…');
    const [showCreate, setShowCreate] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [manualText, setManualText] = useState('');
    const [instruction, setInstruction] = useState('');
    const [xmind, setXmind] = useState(null);
    const [createPhase, setCreatePhase] = useState('idle');
    const [draftMaxNodes, setDraftMaxNodes] = useState(360);
    const [mapActions, setMapActions] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [nodeDraft, setNodeDraft] = useState(null);
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [workspaceWidth, setWorkspaceWidth] = useState(0);
    const workspaceRef = useRef(null);
    const [panelRun, setPanelRun] = useState(null);
    const createControllerRef = useRef(null);
    const galleryRequestRef = useRef(null);
    const recordRef = useRef(null);
    useEffect(() => { recordRef.current = record; }, [record]);
    useEffect(() => {
        const workspace = workspaceRef.current;
        if (!workspace)
            return;
        const update = () => setWorkspaceWidth(Math.round(workspace.getBoundingClientRect().width));
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
        observer?.observe(workspace);
        window.addEventListener('resize', update);
        update();
        return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
    }, []);
    useEffect(() => { setSelectedNode(null); setNodeDraft(null); }, [record?.libraryId, record?.current.source.generatedAt]);
    const refresh = useCallback((force = false) => {
        let active = true;
        setGalleryState('loading');
        setStatus('正在读取脑图库…');
        const key = showArchived ? 'archived' : 'active';
        const request = !force && galleryRequestRef.current?.key === key
            ? galleryRequestRef.current.promise
            : api(`/maps${showArchived ? '?archived=true' : ''}`);
        galleryRequestRef.current = { key, promise: request };
        void request.then((next) => {
            if (!active)
                return;
            setMaps(next);
            setSelectedId((prev) => prev && next.some((item) => item.libraryId === prev) ? prev : next[0]?.libraryId);
            setGalleryState('ready');
            setStatus(`${next.length} 张${showArchived ? '已归档' : '活动'}脑图`);
        }).catch((error) => {
            if (!active)
                return;
            if (galleryRequestRef.current?.promise === request)
                galleryRequestRef.current = null;
            setGalleryState('failed');
            setStatus(`图库加载失败：${error instanceof Error ? error.message : String(error)}`);
        });
        return () => { active = false; };
    }, [showArchived]);
    useEffect(() => refresh(), [refresh]);
    useEffect(() => { if (!selectedId) {
        setRecord(null);
        setInstruction('');
        return;
    } ; void api(`/maps/${encodeURIComponent(selectedId)}`).then((next) => { setRecord(next); setInstruction(next.config.instruction ?? ''); }).catch((error) => setStatus(String(error))); }, [selectedId]);
    useEffect(() => {
        if (!panelRun || panelRun.status !== 'running')
            return;
        let active = true;
        const poll = () => void api(`/panel-runs/${encodeURIComponent(panelRun.runId)}`).then((next) => {
            if (!active)
                return;
            setPanelRun(next);
            setStatus(next.detail);
            if (next.status === 'completed') {
                void api(`/maps/${encodeURIComponent(next.libraryId)}`).then((updated) => { if (active) {
                    setRecord(updated);
                    void refresh(true);
                } });
            }
        }).catch((error) => { if (active)
            setStatus(`重新生成状态读取失败：${String(error)}`); });
        poll();
        const timer = window.setInterval(poll, 1_000);
        return () => { active = false; window.clearInterval(timer); };
    }, [panelRun?.runId, panelRun?.status]);
    const persistDocument = (document) => {
        const current = recordRef.current;
        if (!current)
            return;
        void api(`/maps/${encodeURIComponent(current.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document, rotatePrevious: false }) }).then((next) => { setRecord((prev) => prev ? { ...prev, updatedAt: next.updatedAt, current: next.current, previous: next.previous } : next); setStatus('已自动保存当前手动修改'); }).catch((error) => setStatus(String(error)));
    };
    const createMap = () => {
        if (!manualText.trim() || createPhase !== 'idle')
            return;
        const controller = new AbortController();
        createControllerRef.current = controller;
        const title = manualText.split(/\r?\n/)[0]?.replace(/^#\s*/, '');
        setCreatePhase('generating');
        setStatus('正在生成未保存草稿…');
        void api('/generate', { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: manualText, title, source: { kind: 'text', sessionId }, config: { instruction, maxNodes: draftMaxNodes }, save: false }) })
            .then(async (generated) => {
            if (controller.signal.aborted)
                return;
            // From this point the host POST is the commit. It is intentionally not
            // abortable so the UI never reports "not saved" after persistence wins.
            setCreatePhase('saving');
            setStatus('正在保存脑图…');
            await api('/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, document: generated.document, source: { kind: 'text', sessionId }, config: { instruction, maxNodes: draftMaxNodes } }) });
            setShowCreate(false);
            setManualText('');
            void refresh(true);
            setStatus('已创建脑图');
        })
            .catch((error) => { if (controller.signal.aborted)
            setStatus('已取消创建，未保存任何内容');
        else
            setStatus(`创建失败：${error instanceof Error ? error.message : String(error)}`); })
            .finally(() => { if (createControllerRef.current === controller)
            createControllerRef.current = null; setCreatePhase('idle'); });
    };
    const regenerate = () => {
        if (!record)
            return;
        if (!props.sessions.binding(sessionId)?.session) {
            setStatus('当前会话不可用，无法启动 fork 子代理');
            return;
        }
        const note = instruction.trim();
        setStatus(note ? `正在启动 fork 子代理，附带 ${note.length} 字备注…` : '正在启动 fork 子代理…');
        void api(`/maps/${encodeURIComponent(record.libraryId)}/regenerate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, expectedUpdatedAt: record.updatedAt, ...(note ? { instruction: note } : {}) }) })
            .then((run) => { setPanelRun(run); setStatus(run.detail); })
            .catch((error) => setStatus(`无法启动重新生成：${String(error)}`));
    };
    const cancelRegenerate = () => {
        if (!panelRun || panelRun.status !== 'running')
            return;
        void api(`/panel-runs/${encodeURIComponent(panelRun.runId)}`, { method: 'DELETE' })
            .then(() => setStatus('正在取消 fork 子代理…'))
            .catch((error) => setStatus(`取消失败：${String(error)}`));
    };
    const visualConfig = (config) => {
        if (!record)
            return;
        const before = record;
        setRecord({ ...record, config: { ...record.config, ...config } });
        setStatus('正在应用外观配置…');
        void api(`/maps/${encodeURIComponent(record.libraryId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) })
            .then((next) => { setRecord(next); setStatus('外观已立即应用并保存'); })
            .catch((error) => { setRecord(before); setStatus(`外观保存失败：${String(error)}`); });
    };
    const selectNode = (node) => {
        setSelectedNode(node);
        setNodeDraft(node);
        if (node)
            setInspectorOpen(true);
    };
    const saveNode = () => {
        if (!selectedNode || !nodeDraft || !mapActions)
            return;
        const title = nodeDraft.title.trim();
        if (!title) {
            setStatus('节点标题不能为空');
            return;
        }
        mapActions.saveNode({ ...nodeDraft, title });
        setSelectedNode({ ...nodeDraft, title });
        setNodeDraft({ ...nodeDraft, title });
        setStatus('节点修改已应用，正在自动保存');
    };
    const cancelNodeDraft = () => {
        setNodeDraft(selectedNode);
        setInspectorOpen(false);
    };
    return createElement('main', { style: panelStyle() }, createElement('header', { style: { height: '48px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '7px', padding: '0 14px', borderBottom: '1px solid var(--dsw-alias-border-l1,#2c3445)', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#111827))' } }, createElement('button', { type: 'button', onClick: () => setSidebarOpen((open) => !open), style: buttonStyle(), 'aria-label': sidebarOpen ? '收起脑图库' : '展开脑图库', title: sidebarOpen ? '收起脑图库' : '展开脑图库' }, sidebarOpen ? '‹' : '☰'), createElement('strong', { style: { marginRight: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, record?.title ?? '脑图'), galleryState === 'loading' ? createElement('small', { role: 'status', style: { color: '#6b7280' } }, '读取图库…') : null, galleryState === 'failed' ? createElement('button', { type: 'button', onClick: () => void refresh(true), style: buttonStyle() }, '重试') : null, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.undo(), style: buttonStyle(), title: '撤销 Ctrl+Z', 'aria-label': '撤销 Ctrl+Z' }, '↶'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.redo(), style: buttonStyle(), title: '重做 Ctrl+Shift+Z', 'aria-label': '重做 Ctrl+Shift+Z' }, '↷'), createElement('button', { type: 'button', onClick: () => setInspectorOpen((open) => !open), style: buttonStyle(), title: '节点属性', 'aria-label': '打开节点属性' }, '☷'), createElement('details', { style: { position: 'relative' } }, createElement('summary', { style: { ...buttonStyle(), listStyle: 'none', userSelect: 'none' }, 'aria-label': '更多操作' }, '···'), createElement('div', { style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, display: 'grid', gap: '5px', minWidth: '142px', padding: '7px', border: '1px solid #e8eaed', borderRadius: '4px', background: 'var(--dsw-alias-bg-base,#fff)', boxShadow: '0 10px 24px rgba(0,0,0,.14)' } }, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.expandAll(), style: buttonStyle() }, '全部展开'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseAll(), style: buttonStyle() }, '全部折叠'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.collapseToLevel(2), style: buttonStyle() }, '折叠至第 2 层'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.openSvgPreview(), style: buttonStyle() }, '预览 SVG'), createElement('button', { type: 'button', disabled: panelRun?.status === 'running', onClick: regenerate, style: buttonStyle() }, '重新生成'), createElement('hr', { style: { width: '100%', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1,#2c3445)' } }), createElement('button', { type: 'button', onClick: () => downloadBlob(new Blob([JSON.stringify(record?.current, null, 2)], { type: 'application/json' }), safeFilename(record?.title ?? 'mindmap', 'json')), style: buttonStyle() }, '导出 JSON'), createElement('button', { type: 'button', onClick: () => record && downloadBlob(new Blob([markdown(record.current.root)], { type: 'text/markdown' }), safeFilename(record.title, 'md')), style: buttonStyle() }, '导出 Markdown'), createElement('button', { type: 'button', disabled: !xmind, onClick: () => xmind && record && downloadBlob(xmind, safeFilename(record.title, 'xmind')), style: buttonStyle() }, '导出 XMind'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.exportPng(), style: buttonStyle() }, '导出 PNG'))), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => void mapActions?.toggleFullscreen(), style: buttonStyle(), title: '全屏画布', 'aria-label': '全屏画布' }, '⛶')), showCreate && createElement('section', { style: { padding: '8px', marginBottom: '8px', border: '1px solid #334155', borderRadius: '8px' } }, createElement('textarea', { rows: 5, value: manualText, placeholder: '粘贴文本或 Markdown（也可以让 Agent 从 PDF/附件生成）', onChange: (event) => setManualText(event.target.value), style: { ...inputStyle(), resize: 'vertical' } }), createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' } }, '最多节点', createElement('select', { value: draftMaxNodes, onChange: (event) => setDraftMaxNodes(Number(event.target.value)), style: { ...inputStyle(), width: 'auto' }, 'aria-label': '新脑图最多节点' }, [120, 240, 360, 600, 1_000].map((count) => createElement('option', { key: count, value: count }, `${count}`)))), createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, createElement('button', { type: 'button', disabled: createPhase !== 'idle', onClick: createMap, style: buttonStyle() }, createPhase === 'generating' ? '生成草稿中…' : createPhase === 'saving' ? '保存中…' : '生成并保存'), createPhase === 'generating' ? createElement('button', { type: 'button', onClick: () => { createControllerRef.current?.abort(); setStatus('正在取消未保存草稿…'); }, style: buttonStyle() }, '取消') : createElement('button', { type: 'button', disabled: createPhase === 'saving', onClick: () => { setShowCreate(false); setManualText(''); setInstruction(''); setStatus(createPhase === 'saving' ? '脑图正在保存；保存完成后会显示在图库中' : '已取消创建，未保存任何内容'); }, style: buttonStyle() }, createPhase === 'saving' ? '保存中' : '取消'))), createElement('div', { ref: workspaceRef, style: { display: 'grid', gridTemplateColumns: sidebarOpen ? (workspaceWidth > 0 && workspaceWidth < 900 ? '56px minmax(0,1fr)' : '228px minmax(0,1fr)') : '0px minmax(0,1fr)', position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#23262d))' } }, createElement('aside', { style: { overflow: sidebarOpen ? 'auto' : 'hidden', padding: workspaceWidth > 0 && workspaceWidth < 900 ? '8px 4px' : '12px 9px', borderRight: '1px solid var(--dsw-alias-border-l1,#2c3445)', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#171e2e))' } }, createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' } }, createElement('strong', null, '脑图库'), createElement('button', { type: 'button', onClick: () => setShowCreate((value) => !value), style: { ...buttonStyle(), marginLeft: 'auto' }, 'aria-label': '新建脑图' }, '＋')), createElement('input', { value: search, placeholder: '搜索脑图', onChange: (event) => setSearch(event.target.value), style: { ...inputStyle(), marginBottom: '10px' }, 'aria-label': '搜索脑图' }), maps.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((item) => createElement('button', { key: item.libraryId, type: 'button', onClick: () => setSelectedId(item.libraryId), title: item.title, style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 7px', marginBottom: '1px', border: 0, borderLeft: selectedId === item.libraryId ? '3px solid var(--dsw-alias-brand-primary,#14b8a6)' : '3px solid transparent', borderRadius: 0, background: selectedId === item.libraryId ? 'var(--dsw-alias-interactive-bg-hover,rgba(20,184,166,.10))' : 'transparent', color: 'inherit', cursor: 'pointer' } }, createElement('strong', { style: { display: 'block', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title), createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, `${item.nodeCount} nodes · ${item.source?.kind?.toUpperCase() ?? 'MAP'}`))), createElement('button', { type: 'button', onClick: () => setShowArchived((value) => !value), style: { ...buttonStyle(), marginTop: '10px' } }, showArchived ? '查看活动脑图' : '查看归档脑图')), record ? createElement('section', { style: { minWidth: 0, minHeight: 0, flex: '1 1 0', display: 'flex', flexDirection: 'column', gap: 0 } }, panelRun?.libraryId === record.libraryId ? createElement('div', { role: 'status', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', borderRadius: '7px', background: panelRun.status === 'failed' ? 'rgba(127,29,29,.38)' : panelRun.status === 'completed' ? 'rgba(6,78,59,.38)' : 'rgba(30,41,59,.72)', border: '1px solid #475569' } }, createElement('strong', null, panelRun.status === 'running' ? 'Fork 子代理运行中' : panelRun.status === 'completed' ? '重新生成完成' : panelRun.status === 'cancelled' ? '重新生成已取消' : '重新生成失败'), createElement('span', { style: { opacity: .78 } }, panelRun.detail, panelRun.noteLength ? ` · 已传入 ${panelRun.noteLength} 字备注` : null), panelRun.childId ? createElement('code', { style: { opacity: .62, fontSize: '11px' } }, `子代理 ${panelRun.childId}`) : null, panelRun.status === 'running' ? createElement('button', { type: 'button', onClick: cancelRegenerate, style: { ...buttonStyle(), marginLeft: 'auto' } }, '取消') : null) : null, createElement('div', { style: { display: 'flex', flexDirection: 'column', position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' } }, createElement(MapCanvas, { key: `${record.libraryId}:${record.current.source.generatedAt}`, record, onDocumentChange: persistDocument, onXmind: setXmind, onActions: setMapActions, onFullscreenChange: () => undefined, onNodeSelect: selectNode }), createElement('div', { style: { position: 'absolute', right: '16px', bottom: '16px', zIndex: 2, display: 'flex', alignItems: 'center', gap: '2px', padding: '3px 5px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 78%, transparent)', borderRadius: '999px', background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 86%, transparent)', boxShadow: '0 4px 14px rgba(0,0,0,.12)', backdropFilter: 'blur(8px)' } }, createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomOut(), style: zoomButtonStyle(), 'aria-label': '缩小画布' }, '−'), createElement('button', { type: 'button', disabled: !mapActions, onClick: () => mapActions?.zoomIn(), style: zoomButtonStyle(), 'aria-label': '放大画布' }, '＋'))))
        : createElement('section', { style: { display: 'grid', placeItems: 'center', minHeight: '480px', opacity: .7 } }, '暂无脑图。可以点击“新建”，或让 Agent 从文本/PDF/附件生成。')), inspectorOpen ? createElement('aside', { style: { position: 'absolute', top: '16px', right: '16px', bottom: '16px', zIndex: 4, width: 'min(300px, calc(100% - 276px))', overflow: 'auto', boxSizing: 'border-box', padding: '16px', border: '1px solid var(--dsw-alias-border-l1,#2c3445)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#171e2e))', boxShadow: 'var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.30))' } }, createElement('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '16px' } }, createElement('strong', null, '节点属性'), createElement('button', { type: 'button', onClick: cancelNodeDraft, style: { ...buttonStyle(), marginLeft: 'auto' }, 'aria-label': '收起节点属性' }, '×')), nodeDraft ? createElement('div', { style: { display: 'grid', gap: '12px' } }, createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: '#6b7280' } }, '标题'), createElement('input', { value: nodeDraft.title, onChange: (event) => setNodeDraft({ ...nodeDraft, title: event.target.value }), style: inputStyle(), 'aria-label': '节点标题' })), createElement('label', { style: { display: 'grid', gap: '5px' } }, createElement('small', { style: { color: '#6b7280' } }, `备注 · ${nodeDraft.note.length} 字`), createElement('textarea', { rows: 8, value: nodeDraft.note, onChange: (event) => setNodeDraft({ ...nodeDraft, note: event.target.value }), placeholder: '添加节点备注', style: { ...inputStyle(), resize: 'vertical' }, 'aria-label': '节点备注' })), createElement('div', { style: { display: 'flex', gap: '6px' } }, createElement('button', { type: 'button', onClick: saveNode, style: { ...buttonStyle(), background: '#14b8a6', color: '#fff', borderColor: '#14b8a6' } }, '保存'), createElement('button', { type: 'button', onClick: cancelNodeDraft, style: buttonStyle() }, '取消'))) : createElement('div', { style: { display: 'grid', gap: '12px' } }, createElement('p', { style: { color: '#6b7280', margin: 0 } }, '选择一个节点以编辑标题和备注。'), record ? createElement('section', { style: { display: 'grid', gap: '9px', paddingTop: '10px', borderTop: '1px solid #e8eaed' } }, createElement('strong', null, '脑图样式'), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', { style: { color: '#6b7280' } }, '结构'), createElement('select', { value: record.config.layout, onChange: (event) => visualConfig({ layout: event.target.value }), style: inputStyle(), 'aria-label': '脑图结构' }, LAYOUT_OPTIONS.map(([value, label]) => createElement('option', { key: value, value }, label)))), createElement('label', { style: { display: 'grid', gap: '4px' } }, createElement('small', { style: { color: '#6b7280' } }, '主题'), createElement('select', { value: record.config.theme, onChange: (event) => visualConfig({ theme: event.target.value }), style: inputStyle(), 'aria-label': '脑图主题' }, Object.entries(THEME_PRESETS).map(([value, preset]) => createElement('option', { key: value, value }, preset.label))))) : null)) : null, createElement('span', { role: 'status', style: { position: 'absolute', left: '244px', bottom: '8px', zIndex: 3, maxWidth: 'calc(100% - 280px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 6px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', fontSize: '11px', pointerEvents: 'none' } }, status));
}
export function apply(ctx) {
    ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: `${PLUGIN_ID}-panel`, order: 20, label: () => '脑图', inject: (sessionId) => ({ sessions: ctx.sessions, sessionId }) }, BrainmapView)), `${PLUGIN_ID}: brainmap view`);
    ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'present_chat_mindmap' }, MindmapToolCard)), `${PLUGIN_ID}: chat SVG preview`);
}
