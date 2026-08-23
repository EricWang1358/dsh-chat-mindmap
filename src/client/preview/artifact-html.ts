/** Generated-artifact template (color-scan exemption: output, not chrome). */
export function svgPreviewHtml(svgUrl: string, title: string): string {
  const escapedTitle = title.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const encodedUrl = JSON.stringify(svgUrl).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle} · SVG 预览</title><style>html,body{margin:0;min-height:100%;background:#0f172a}body{display:grid;place-items:center;padding:16px;box-sizing:border-box}img{display:block;max-width:100%;max-height:calc(100vh - 32px);background:#fff;border-radius:8px}</style></head><body><img src="${svgUrl}" alt="${escapedTitle} 思维导图"><script>window.addEventListener('beforeunload',()=>URL.revokeObjectURL(${encodedUrl}))</script></body></html>`
}
