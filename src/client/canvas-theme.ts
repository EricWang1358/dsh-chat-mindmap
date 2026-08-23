/** Canvas renderer data + theme logic (D-S3-9 single source). */
/* @token-exempt-begin: SimpleMindMap renderer data - canvas content, not UI chrome (§13.3). */

export type ThemePreset = { label: string; config: Record<string, unknown> }

export const LAYOUT_OPTIONS = [
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
] as const

export const THEME_PRESETS: Record<string, ThemePreset> = {
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
}

export function themePreset(theme: string): ThemePreset { return THEME_PRESETS[theme] ?? THEME_PRESETS.default }
export function shellIsDark(): boolean {
  if (typeof window === 'undefined') return false
  const root = window.document.documentElement
  if (/dark|night/i.test(`${root.className} ${root.getAttribute('data-theme') ?? ''}`)) return true
  const color = window.getComputedStyle(window.document.body).backgroundColor
  const channels = color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
  if (channels?.length === 3) return (channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722) < 128
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
export function shellThemeConfig(theme: string, dark: boolean): ThemePreset {
  if (theme !== 'default') return themePreset(theme)
  return dark
    ? { label: '默认青绿（夜间）', config: { backgroundColor: '#24262c', lineColor: '#5eead4', generalizationLineColor: '#5eead4', root: { fillColor: '#0f766e', color: '#f8fafc', borderColor: '#2dd4bf' }, second: { fillColor: '#30333a', color: '#f8fafc', borderColor: '#5eead4' }, node: { color: '#e5e7eb', borderColor: 'transparent' } } }
    : { label: '默认青绿（日间）', config: { backgroundColor: '#f9fafb', lineColor: '#0f766e', generalizationLineColor: '#0f766e', root: { fillColor: '#0f766e', color: '#fff', borderColor: '#0d5f59' }, second: { fillColor: '#ecfdf5', color: '#134e4a', borderColor: '#5eead4' }, node: { color: '#1f2937', borderColor: 'transparent' } } }
}

/* @token-exempt-end */
