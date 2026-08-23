/** S4.5-W2/W4: A3 landscape self-contained print HTML generator.
 *  Zero external references; all text/attributes escaped (W4). */
import type { ExportDoc, ExportBranch } from '../../domain/mindmap-doc.js'
import { resolveTheme, type ExportTheme } from './themes.js'

export function escText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const SAFE_URL_PROTOCOL = /^(?:https?:|mailto:|\/[^\/]|#[a-zA-Z_])/

export function escUrl(value: string): string {
  const trimmed = value.trim()
  if (!SAFE_URL_PROTOCOL.test(trimmed) && !trimmed.startsWith('/') && !trimmed.startsWith('#')) return '#'
  return escAttr(trimmed)
}

function renderBranchPage(branch: ExportBranch, theme: ExportTheme, pageIndex: number): string {
  const items = [...branch.inlineItems, ...branch.groups.flatMap((g) => g.items.map((i) => ({ ...i, groupTitle: g.title })))]
  const itemHtml = items.map((item) => {
    const groupTag = 'groupTitle' in item ? '<span class="group-tag">' + escText((item as Record<string, unknown>).groupTitle as string) + '</span> ' : ''
    const noteHtml = item.note ? '<div class="note">' + escText(item.note) + '</div>' : ''
    const subHtml = item.subItems.length > 0 ? '<ul class="sub-items">' + item.subItems.map((s) => '<li>' + escText(s.text) + '</li>').join('') + '</ul>' : ''
    return '<div class="item">' + groupTag + '<strong>' + escText(item.text) + '</strong>' + subHtml + noteHtml + '</div>'
  }).join('\n')

  return (
    '<section class="page branch-page" id="page-' + pageIndex + '">' +
    '<h2 class="branch-title">' + escText(branch.title) + '</h2>' +
    '<div class="items" style="columns:' + theme.columns + ';column-gap:24px">' + itemHtml + '</div>' +
    '<footer class="page-footer">Page ' + pageIndex + '</footer>' +
    '</section>'
  )
}

export interface PrintOptions {
  theme?: string
  includeCover?: boolean
  includeToc?: boolean
  includeNotes?: boolean
}

/**
 * Generate a self-contained A3-landscape HTML document for printing.
 * All user content is escaped via escText/escAttr. No <script>, no CDN.
 */
export function renderPrintHtml(doc: ExportDoc, options: PrintOptions = {}): string {
  const theme = resolveTheme(options.theme)
  const includeCover = options.includeCover !== false
  const includeToc = options.includeToc !== false

  const cssVarsBlock = Object.entries(theme.cssVars).map(([k, v]: [string, string]) => k + ':' + v).join(';')

  let tocHtml = ''
  if (includeToc) {
    const entries = doc.branches.map((b, i) =>
      '<li><a href="#page-' + (i + 1) + '">' + escText(b.title) + '</a></li>'
    ).join('')
    tocHtml = '<nav class="toc"><h2>目录 / Table of Contents</h2><ol>' + entries + '</ol></nav>'
  }

  const coverHtml = includeCover
    ? '<section class="page cover-page"><h1>' + escText(doc.title) + '</h1><p class=\"subtitle\">A3 Landscape Export · ' + escAttr(theme.label) + '</p></section>'
    : ''

  const pagesHtml = doc.branches.map((b, i) => renderBranchPage(b, theme, i + 1)).join('\n')

  const overflowHtml = doc.overflow.length > 0
    ? '<aside class="overflow-report"><h3>溢出报告 / Overflow Report</h3><ul>' +
      doc.overflow.map((o) => '<li><strong>' + escText(o.type) + '</strong>: ' + escText(o.path) + ' — ' + escText(o.detail) + '</li>').join('') +
      '</ul></aside>'
    : ''

  const notesColumn = options.includeNotes !== false
    ? '<style>.item .note { display: block; }</style>'
    : '<style>.item .note { display: none; }</style>'

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>' + escText(doc.title) + ' · A3 Export</title>',
    '<style>',
    ':root{' + cssVarsBlock + '}',
    '@page{size:A3 landscape;margin:15mm}',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:' + theme.fontFamily + ';background:var(--ex-bg);color:var(--ex-text);font-size:14px;line-height:1.6}',
    '.page{page-break-after:always;min-height:calc(100vh - 30mm);padding:8mm;border:1px solid var(--ex-border)}',
    '.cover-page h1{font-size:36pt;text-align:center;margin-top:35vh}',
    '.cover-page .subtitle{text-align:center;color:var(--ex-accent);margin-top:16px;font-size:12pt}',
    '.toc{padding:20mm 10mm}',
    '.toc li{margin-bottom:6px}',
    '.toc a{color:var(--ex-accent);text-decoration:none}',
    '.branch-title{font-size:22pt;color:var(--ex-accent);border-bottom:2px solid var(--ex-border);padding-bottom:8px;margin-bottom:16px}',
    '.items{display:grid;gap:10px}',
    '.item{background:var(--ex-branch-bg);padding:10px 12px;border-radius:' + (theme.name === 'creative' ? '12px' : '4px') + ';break-inside:avoid}',
    '.group-tag{display:inline-block;background:var(--ex-accent);color:#fff;padding:1px 6px;border-radius:3px;font-size:11px;margin-right:6px}',
    '.sub-items{margin-left:18px;margin-top:4px}',
    '.sub-items li{font-size:13px}',
    '.note{background:var(--ex-note-bg);padding:6px 8px;margin-top:6px;border-left:3px solid var(--ex-accent);font-size:12px;color:var(--dsw-text-secondary,var(--ex-text))}',
    '.overflow-report{position:fixed;top:0;right:0;width:280px;background:var(--ex-note-bg);border-left:2px solid var(--ex-accent);padding:10px;font-size:11px;z-index:99}',
    '.overflow-report ul{list-style:disc;margin-left:16px}',
    '.page-footer{text-align:center;font-size:10px;color:var(--dsw-label-secondary,var(--ex-text));opacity:.5;margin-top:auto}',
    notesColumn,
    '</style>',
    '</head>',
    '<body>',
    coverHtml,
    tocHtml,
    pagesHtml,
    overflowHtml,
    '</body></html>',
  ].join('\n')
}
