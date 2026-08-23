/**
 * W3 own minimal accessible primitives over --dsw-* tokens.
 * rc8 exports no public Button/Menu/Modal/etc. (W0(e) adjudication): these are
 * plugin-local, never imitating official component names or copied CSS.
 * Colors reference shell tokens directly - no fallback literals here.
 */
import { createElement, useEffect, type ReactElement } from 'react'

type ButtonProps = { variant?: 'default' | 'primary' | 'ghost'; style?: Record<string, unknown>; children?: unknown } & Record<string, unknown>
export function DswButton({ variant = 'default', style, children, ...rest }: ButtonProps): ReactElement {
  const base = variant === 'primary'
    ? { border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-bg-base)' }
    : variant === 'ghost'
      ? { border: '0', background: 'transparent', color: 'inherit', cursor: 'pointer' }
      : { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-button-tool-bar-fill)', color: 'inherit', cursor: 'pointer' }
  return createElement('button', Object.assign({ type: 'button' }, rest, { style: { ...base, ...(style ?? {}) } }), children as never)
}

export function DswInput(props: Record<string, unknown>): ReactElement {
  const { style, ...rest } = props
  return createElement('input', Object.assign({}, rest, { style: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', borderRadius: '4px', padding: '7px', boxSizing: 'border-box', ...(style ?? {}) } }))
}

export type StateTone = 'running' | 'ok' | 'failed' | 'idle'
export function DswStateDot({ tone, label }: { tone: StateTone; label: string }): ReactElement {
  return createElement('span', { role: 'img', 'aria-label': label, title: label, style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: tone === 'ok' ? 'var(--dsw-alias-success, var(--dsw-alias-brand-primary))' : tone === 'failed' ? 'var(--dsw-alias-danger, var(--dsw-alias-label-secondary))' : tone === 'running' ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent)' : 'var(--dsw-alias-border-l2)' } })
}

export function DswTooltip({ tip, children }: { tip: string; children: ReactElement }): ReactElement {
  return createElement('span', { title: tip, style: { display: 'inline-flex' } }, children)
}

type MenuItem = { key: string; label: string; onSelect(): void; disabled?: boolean }
export function DswMenu({ label, items }: { label: string; items: readonly MenuItem[] }): ReactElement {
  return createElement('details', { style: { position: 'relative' } },
    createElement('summary', { 'aria-haspopup': 'menu', style: { listStyle: 'none', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-button-tool-bar-fill)', color: 'inherit', borderRadius: '4px', padding: '5px 8px', userSelect: 'none' } }, label),
    createElement('div', { role: 'menu', style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, display: 'grid', gap: '5px', minWidth: '150px', padding: '7px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px', background: 'var(--dsw-alias-bg-base)', boxShadow: 'var(--dsw-shadow-lv2)' } },
      items.filter((item) => !item.disabled !== false).map((item) => createElement('button', { key: item.key, role: 'menuitem', type: 'button', disabled: item.disabled === true, onClick: item.onSelect, style: { border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', padding: '4px 6px' } }, item.label))))
}

type ModalProps = { open: boolean; label: string; onClose(): void; children: ReactElement | readonly ReactElement[] }
export function DswModal({ open, label, onClose, children }: ModalProps): ReactElement | null {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createElement('div', { role: 'dialog', 'aria-modal': true, 'aria-label': label, onClick: onClose, style: { position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent)' } },
    createElement('div', { onClick: (event: Event) => event.stopPropagation(), style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', padding: '16px' } }, children))
}

export function DswToast({ message, tone = 'info' }: { message: string | null; tone?: 'info' | 'error' }): ReactElement | null {
  if (!message) return null
  return createElement('div', { role: tone === 'error' ? 'alert' : 'status', 'aria-live': 'polite', style: { position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: 40, maxWidth: 'min(520px, calc(100vw - 32px))', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: tone === 'error' ? 'var(--dsw-alias-danger, var(--dsw-alias-label-primary))' : 'var(--dsw-alias-label-primary)' } }, message)
}