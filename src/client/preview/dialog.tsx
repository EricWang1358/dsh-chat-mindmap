import { useEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// S3-W5 owned SVG preview dialog. Read-only by design: the only interactive
// affordances are the backdrop and the explicit close button, both wired to
// the single onClose callback. Tab navigation is trapped inside the dialog
// through the pure cycleFocus helper (directly unit-testable). DialogSurface
// is portal-free so server-side static rendering can assert its structure.
// ---------------------------------------------------------------------------

/** Wrap an index step through a circular list of `count` items. */
export function cycleFocus(count: number, current: number, forward: boolean): number {
  if (count <= 0) return 0
  const delta = forward ? 1 : -1
  return (((current + delta) % count) + count) % count
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export interface SvgPreviewDialogProps { src: string; alt: string; onClose(): void }

export function SvgPreviewDialog(props: SvgPreviewDialogProps): ReactElement {
  return createPortal(<DialogSurface {...props} />, window.document.body)
}

export function DialogSurface({ src, alt, onClose }: SvgPreviewDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreFocusRef.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => !el.hasAttribute('disabled'))
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }
      const current = focusables.indexOf(window.document.activeElement as HTMLElement)
      const target = cycleFocus(focusables.length, current, !event.shiftKey)
      event.preventDefault()
      focusables[target]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus()
    }
  }, [onClose])
  return (
    <div ref={dialogRef} role='dialog' aria-modal='true' aria-label='脑图 SVG 预览' style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center' }}>
      <button type='button' aria-label='关闭预览' onClick={onClose} style={{ position: 'absolute', inset: 0, border: 0, background: 'rgba(2,6,23,.78)', cursor: 'default' }} />
      <section style={{ position: 'relative', zIndex: 1, maxWidth: '92vw', maxHeight: '92vh', padding: '12px', background: 'var(--dsw-alias-bg-base,#0f172a)', borderRadius: '10px' }}>
        <img src={src} alt={alt} style={{ display: 'block', maxWidth: '88vw', maxHeight: '82vh', background: 'var(--dsw-alias-bg-base,#fff)' }} />
        <button ref={closeRef} type='button' onClick={onClose} style={{ border: '1px solid var(--dsw-alias-border-l2,#e8eaed)', background: 'var(--dsw-alias-button-tool-bar-fill,#fff)', color: 'inherit', borderRadius: '4px', padding: '5px 8px', cursor: 'pointer', marginTop: '8px', display: 'block' }}>关闭预览</button>
      </section>
    </div>
  )
}
