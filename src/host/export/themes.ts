/** S4.5-W2: four style presets for A3 landscape export. Each preset is a set
 *  of CSS custom properties consumed by the print-html template; no external
 *  stylesheet, no CDN, fully self-contained output (§20 Phase 4.5). */
export interface ExportTheme {
  name: string
  label: string
  cssVars: Record<string, string>
  fontFamily: string
  columns: 1 | 2
}

export const THEMES: Record<string, ExportTheme> = {
  classic: {
    name: 'classic', label: 'Classic（经典衬线）',
    fontFamily: 'Georgia, "Noto Serif SC", serif',
    columns: 1,
    cssVars: { '--ex-bg': '#faf8f5', '--ex-text': '#2c1810', '--ex-accent': '#8b4513', '--ex-branch-bg': '#f5e6d0', '--ex-border': '#c4a882', '--ex-note-bg': '#fdf6ec' },
  },
  minimal: {
    name: 'minimal', label: 'Minimal（极简黑白）',
    fontFamily: '"Helvetica Neue", "PingFang SC", sans-serif',
    columns: 1,
    cssVars: { '--ex-bg': '#ffffff', '--ex-text': '#111111', '--ex-accent': '#000000', '--ex-branch-bg': '#f5f5f5', '--ex-border': '#cccccc', '--ex-note-bg': '#fafafa' },
  },
  creative: {
    name: 'creative', label: 'Creative（创意圆角）',
    fontFamily: '"Trebuchet MS", "PingFang SC", sans-serif',
    columns: 1,
    cssVars: { '--ex-bg': '#fff0f5', '--ex-text': '#4a0080', '--ex-accent': '#e91e8b', '--ex-branch-bg': '#fce4ec', '--ex-border': '#f48fb1', '--ex-note-bg': '#fff9fa' },
  },
  academic: {
    name: 'academic', label: 'Academic（学术双栏）',
    fontFamily: '"Times New Roman", "Noto Serif SC", serif',
    columns: 2,
    cssVars: { '--ex-bg': '#fefefe', '--ex-text': '#1a1a2e', '--ex-accent': '#16213e', '--ex-branch-bg': '#e8eaf6', '--ex-border': '#9fa8da', '--ex-note-bg': '#f8f9ff' },
  },
}

export const THEME_NAMES = Object.keys(THEMES) as string[]
export type ThemeName = string

export function resolveTheme(name: string | undefined): ExportTheme {
  return THEMES[name ?? ''] ?? THEMES.classic
}
