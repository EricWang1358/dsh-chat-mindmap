import { createElement, useEffect, useState, type ReactElement } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

export type CardSettings = {
  defaultLayout: string
  defaultTheme: string
  defaultDensity: string
  defaultMaxNodes: number
  defaultContextLimit: number
  defaultLanguage: string
  focusGeneratedMap: boolean
  onboardingSeen: boolean
}

const LAYOUT_CHOICES = ['logicalStructure', 'mindMap', 'organizationStructure', 'fishbone', 'fishbone2', 'catalogOrganization']
const THEME_CHOICES = ['default', 'classic4', 'ocean', 'forest', 'sunset', 'lavender', 'graphite', 'rose', 'amber', 'contrast']
const DENSITY_CHOICES = ['compact', 'standard', 'detailed']

function Row({ label, control }: { label: string; control: ReactElement }): ReactElement {
  return createElement('label', { style: { display: 'grid', gap: '4px' } },
    createElement('small', { style: { color: 'var(--dsw-alias-label-secondary)' } }, label),
    control)
}

const fieldStyle = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: '4px',
  padding: '6px',
} as const

/** §13.3/W5 plugin page inside the official Plugins settings section.
 *  Writes go through the client settings scope (official mirror/scope);
 *  values only ever seed NEW mindmaps (§7). */
export function MindmapSettingsCard({ scope }: { scope: SettingsScope<CardSettings> }): ReactElement {
  const [, bump] = useState(0)
  useEffect(() => scope.subscribe(() => bump((n) => n + 1)), [scope])
  const snap = scope.getSnapshot()
  if (snap.status !== 'ready' || !snap.value) {
    return createElement('p', null, '设置尚未就绪。')
  }
  const value = snap.value as Record<string, unknown>
  const set = (field: string, next: unknown): void => {
    void (scope as unknown as { set(field: string, next: unknown): Promise<unknown> }).set(field, next)
  }
  const select = (field: string, choices: readonly string[]) => createElement('select',
    { value: String(value[field] ?? ''), onChange: (event: Event) => set(field, (event.target as HTMLSelectElement).value), style: fieldStyle },
    choices.map((choice) => createElement('option', { key: choice, value: choice }, choice)))
  const number = (field: string, min: number, max: number, step = 1) => createElement('input',
    { type: 'number', min, max, step, value: Number(value[field] ?? 0), onChange: (event: Event) => { const n = Number((event.target as HTMLInputElement).value); if (Number.isFinite(n)) set(field, n) }, style: fieldStyle })
  return createElement('div', { style: { display: 'grid', gap: '12px', maxWidth: '420px' } },
    createElement('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)' } }, '以下默认值只影响之后新建的脑图；已有脑图保持各自配置（§7）。'),
    createElement(Row, { label: '默认布局', control: select('defaultLayout', LAYOUT_CHOICES) }),
    createElement(Row, { label: '默认主题', control: select('defaultTheme', THEME_CHOICES) }),
    createElement(Row, { label: '默认密度', control: select('defaultDensity', DENSITY_CHOICES) }),
    createElement(Row, { label: '默认最多节点（8–2000）', control: number('defaultMaxNodes', 8, 2000) }),
    createElement(Row, { label: '默认上下文预算（8000–200000）', control: number('defaultContextLimit', 8000, 200000, 1000) }),
    createElement(Row, { label: '新图聚焦到生成结果', control: createElement('input', { type: 'checkbox', checked: value.focusGeneratedMap === true, onChange: (event: Event) => set('focusGeneratedMap', (event.target as HTMLInputElement).checked) }) }),
    createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', paddingTop: '4px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
      createElement('div', null, createElement('strong', { style: { display: 'block', fontSize: '13px' } }, '使用指南'), createElement('small', { style: { display: 'block', marginTop: '2px', color: 'var(--dsw-alias-label-secondary)' } }, '重新打开脑图工作台的三步操作指南。')),
      createElement('button', { type: 'button', onClick: () => set('onboardingSeen', false), style: { ...fieldStyle, cursor: 'pointer', whiteSpace: 'nowrap' } }, '重新查看')))
}
