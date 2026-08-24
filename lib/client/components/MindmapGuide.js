import { createElement, useEffect, useRef, useState } from 'react';
import { createT } from '../locale.js';
const STAGES = [
    { nav: 'guide.stage.generate.nav', title: 'guide.stage.generate.title', body: 'guide.stage.generate.body', primary: 'guide.stage.generate.primary' },
    { nav: 'guide.stage.refine.nav', title: 'guide.stage.refine.title', body: 'guide.stage.refine.body', primary: 'guide.stage.refine.primary' },
    { nav: 'guide.stage.export.nav', title: 'guide.stage.export.title', body: 'guide.stage.export.body', primary: 'guide.stage.export.primary' },
];
function focusableElements(root) {
    return Array.from(root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
}
/** An accessible, intentionally small walkthrough of actions the workspace already supports. */
export function MindmapGuide({ open, localeId, hasMap, onDismiss, onCreate, onOpenInspector, onOpenMore }) {
    const t = createT(localeId);
    const [stage, setStage] = useState(0);
    const dialogRef = useRef(null);
    const priorFocus = useRef(null);
    useEffect(() => {
        if (!open)
            return;
        priorFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusDialog = () => focusableElements(dialogRef.current ?? document.body)[0]?.focus();
        window.requestAnimationFrame(focusDialog);
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onDismiss();
                return;
            }
            if (event.key !== 'Tab')
                return;
            const items = focusableElements(dialogRef.current ?? document.body);
            if (items.length === 0)
                return;
            const active = document.activeElement;
            const index = items.indexOf(active);
            const nextIndex = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
            event.preventDefault();
            items[nextIndex]?.focus();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            priorFocus.current?.focus();
        };
    }, [open, onDismiss]);
    if (!open)
        return null;
    const current = STAGES[stage];
    const isFirst = stage === 0;
    const isFinal = stage === 2;
    const advance = () => setStage((currentStage) => Math.min(2, currentStage + 1));
    const primary = () => {
        if (stage === 0) {
            onCreate();
            return;
        }
        if (stage === 1 && hasMap) {
            onOpenInspector();
            return;
        }
        if (stage === 2 && hasMap) {
            onOpenMore();
            return;
        }
        if (isFinal) {
            onDismiss();
            return;
        }
        advance();
    };
    const primaryLabel = !hasMap && stage === 1 ? t('guide.continue') : !hasMap && stage === 2 ? t('guide.finish') : t(current.primary);
    return createElement('div', { role: 'presentation', 'data-mm-guide-overlay': 'true', onMouseDown: (event) => { if (event.target === event.currentTarget)
            onDismiss(); }, style: { position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: '24px', boxSizing: 'border-box', background: 'color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 64%, transparent)', backdropFilter: 'blur(7px) saturate(120%)', WebkitBackdropFilter: 'blur(7px) saturate(120%)' } }, createElement('div', { ref: dialogRef, role: 'dialog', 'data-mm-glass': 'true', 'aria-modal': true, 'aria-label': t('guide.label'), style: { width: 'min(720px, 100%)', maxHeight: 'calc(100dvh - 48px)', overflow: 'auto', borderRadius: '20px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 62%, var(--dsw-alias-label-primary,#e2e8f0) 14%)', background: 'linear-gradient(145deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1,#171e2e) 92%, transparent), color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 96%, transparent))', boxShadow: 'inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary,#e2e8f0) 18%, transparent), 0 28px 90px color-mix(in srgb, var(--dsw-alias-bg-base,#111827) 55%, transparent)', color: 'var(--dsw-alias-label-primary,#e2e8f0)' } }, createElement('header', { style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 20px', borderBottom: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 62%, transparent)' } }, createElement('div', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: '31px', height: '31px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 18%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 38%, transparent)', color: 'var(--dsw-alias-brand-primary,#14b8a6)', fontWeight: '750', fontSize: '12px' } }, String(stage + 1)), createElement('div', { style: { minWidth: 0, marginRight: 'auto' } }, createElement('strong', { style: { display: 'block', letterSpacing: '-.015em' } }, t('guide.title')), createElement('small', { style: { display: 'block', marginTop: '2px', color: 'var(--dsw-alias-label-secondary,#94a3b8)' } }, t('guide.progress', { current: stage + 1, total: STAGES.length }))), createElement('button', { type: 'button', onClick: onDismiss, style: { minWidth: '32px', minHeight: '32px', border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 82%, transparent)', borderRadius: '10px', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }, 'aria-label': t('guide.close'), title: t('guide.close'), 'data-mm-action': 'true' }, '×')), createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(132px,.66fr) minmax(0,1.8fr)', gap: 'clamp(20px,4vw,42px)', padding: 'clamp(22px,4vw,38px)' } }, createElement('nav', { 'aria-label': t('guide.progressNav'), style: { display: 'grid', alignContent: 'start', gap: '5px' } }, STAGES.map((item, index) => createElement('button', { key: item.nav, type: 'button', onClick: () => setStage(index), 'aria-current': stage === index ? 'step' : undefined, style: { display: 'grid', gridTemplateColumns: '22px minmax(0,1fr)', gap: '8px', alignItems: 'center', padding: '8px', border: '1px solid transparent', borderRadius: '10px', background: stage === index ? 'color-mix(in srgb, var(--dsw-alias-brand-primary,#14b8a6) 14%, transparent)' : 'transparent', color: stage === index ? 'var(--dsw-alias-label-primary,#e2e8f0)' : 'var(--dsw-alias-label-secondary,#94a3b8)', textAlign: 'left', cursor: 'pointer', font: 'inherit' }, 'data-mm-guide-stage': String(index + 1) }, createElement('span', { 'aria-hidden': true, style: { display: 'grid', placeItems: 'center', width: '20px', height: '20px', borderRadius: '50%', background: stage === index ? 'var(--dsw-alias-brand-primary,#14b8a6)' : 'color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 72%, transparent)', color: stage === index ? 'var(--dsw-alias-bg-base,#111827)' : 'inherit', fontSize: '10px', fontWeight: '750' } }, String(index + 1)), createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: stage === index ? '650' : '520' } }, t(item.nav))))), createElement('section', { style: { minWidth: 0, paddingLeft: 'clamp(0px,3vw,30px)', borderLeft: '1px solid color-mix(in srgb, var(--dsw-alias-border-l1,#2c3445) 55%, transparent)' } }, createElement('small', { style: { display: 'block', color: 'var(--dsw-alias-brand-primary,#14b8a6)', fontWeight: '700', letterSpacing: '.035em' } }, t(current.nav)), createElement('h2', { style: { margin: '9px 0 0', fontSize: 'clamp(22px,4vw,30px)', lineHeight: 1.13, letterSpacing: '-.035em' } }, t(current.title)), createElement('p', { style: { margin: '12px 0 0', maxWidth: '42ch', color: 'var(--dsw-alias-label-secondary,#94a3b8)', lineHeight: 1.65 } }, t(current.body)), !hasMap && stage > 0 ? createElement('small', { style: { display: 'block', marginTop: '14px', color: 'var(--dsw-alias-label-secondary,#94a3b8)', lineHeight: 1.5 } }, t('guide.requiresMap')) : null, createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginTop: '30px' } }, createElement('div', { style: { display: 'flex', gap: '8px' } }, !isFirst ? createElement('button', { type: 'button', onClick: () => setStage((currentStage) => Math.max(0, currentStage - 1)), style: { border: '1px solid color-mix(in srgb, var(--dsw-alias-border-l2,#475569) 82%, transparent)', borderRadius: '10px', padding: '8px 11px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' }, 'data-mm-action': 'true' }, t('guide.back')) : null, createElement('button', { type: 'button', onClick: onDismiss, style: { border: 0, padding: '8px 4px', background: 'transparent', color: 'var(--dsw-alias-label-secondary,#94a3b8)', cursor: 'pointer', font: 'inherit' }, 'data-mm-action': 'true' }, t('guide.skip'))), createElement('button', { type: 'button', onClick: primary, style: { border: '1px solid var(--dsw-alias-brand-primary,#14b8a6)', borderRadius: '10px', padding: '8px 12px', background: 'var(--dsw-alias-brand-primary,#14b8a6)', color: 'var(--dsw-alias-bg-base,#111827)', cursor: 'pointer', font: '650 13px/18px system-ui,sans-serif' }, 'data-mm-guide-primary': 'true', 'data-mm-action': 'true' }, primaryLabel))))));
}
