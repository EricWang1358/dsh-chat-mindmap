import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
// ---------------------------------------------------------------------------
// S3-W5 owned image preview dialog. Read-only by design: the only interactive
// affordances are the backdrop and the explicit close button, both wired to
// the single onClose callback. Tab navigation is trapped inside the dialog
// through the pure cycleFocus helper (directly unit-testable). DialogSurface
// is portal-free so server-side static rendering can assert its structure.
// ---------------------------------------------------------------------------
/** Wrap an index step through a circular list of `count` items. */
export function cycleFocus(count, current, forward) {
    if (count <= 0)
        return 0;
    const delta = forward ? 1 : -1;
    return (((current + delta) % count) + count) % count;
}
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
export function ImagePreviewDialog(props) {
    return createPortal(_jsx(DialogSurface, { ...props }), window.document.body);
}
export function DialogSurface({ src, alt, onClose }) {
    const dialogRef = useRef(null);
    const closeRef = useRef(null);
    const restoreFocusRef = useRef(null);
    useEffect(() => {
        restoreFocusRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
        closeRef.current?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab')
                return;
            const root = dialogRef.current;
            if (!root)
                return;
            const focusables = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => !el.hasAttribute('disabled'));
            if (focusables.length === 0) {
                event.preventDefault();
                return;
            }
            const current = focusables.indexOf(window.document.activeElement);
            const target = cycleFocus(focusables.length, current, !event.shiftKey);
            event.preventDefault();
            focusables[target]?.focus();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            restoreFocusRef.current?.focus();
        };
    }, [onClose]);
    return (_jsxs("div", { ref: dialogRef, role: 'dialog', "aria-modal": 'true', "aria-label": '\u8111\u56FE\u56FE\u7247\u9884\u89C8', style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center' }, children: [_jsx("button", { type: 'button', "aria-label": '\u5173\u95ED\u9884\u89C8', onClick: onClose, style: { position: 'absolute', inset: 0, border: 0, background: 'rgba(2,6,23,.78)', cursor: 'default' } }), _jsxs("section", { style: { position: 'relative', zIndex: 1, maxWidth: '92vw', maxHeight: '92vh', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', borderRadius: '10px' }, children: [_jsx("img", { src: src, alt: alt, style: { display: 'block', maxWidth: '88vw', maxHeight: '82vh', background: 'var(--dsw-alias-bg-base,#fff)' } }), _jsx("button", { ref: closeRef, type: 'button', onClick: onClose, style: { border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'inherit', borderRadius: '4px', padding: '5px 8px', cursor: 'pointer', marginTop: '8px', display: 'block' }, children: "\u5173\u95ED\u9884\u89C8" })] })] }));
}
