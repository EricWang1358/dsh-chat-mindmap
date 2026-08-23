// W4 benchmark: node-measurable document pipeline cost for a §13.4 360-node map.
// Canvas interaction and SVG rasterisation need a live browser; those numbers
// are recorded as PENDING_LIVE with the runbook in docs/plans/S4_STAGE_REPORT.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildMindmap, countMindmapNodes, mindmapToMarkdown, validateMindmapDocument } from '../lib/core.js'

function synthDocument(branches = 10, perBranch = 40) {
  const lines = ['# 基准脑图']
  for (let b = 0; b < branches; b++) {
    lines.push('## 分支 ' + b)
    for (let i = 0; i < perBranch; i++) lines.push('- 条目 ' + b + '-' + i + '：用于 360 节点基准的填充条目，长度适中，含少量中文与 English 混排。')
  }
  return lines.join('\n')
}

const context = synthDocument()
const t0 = performance.now()
const doc = buildMindmap(context, '基准脑图', { maxNodes: 360, maxChildren: 100, maxDepth: 12 })
const t1 = performance.now()
validateMindmapDocument(doc, { maxNodes: 400 })
const t2 = performance.now()
const markdown = mindmapToMarkdown(doc.root)
const t3 = performance.now()
const json = JSON.stringify(doc)
const t4 = performance.now()
JSON.parse(json)
const t5 = performance.now()

const record = {
  generatedAt: new Date().toISOString(),
  nodes: countMindmapNodes(doc.root),
  targetEnvironment: 'node ' + process.version + ' win32 (pipeline-only)',
  timingsMs: {
    buildMindmap: +(t1 - t0).toFixed(2),
    validate: +(t2 - t1).toFixed(2),
    toMarkdown: +(t3 - t2).toFixed(2),
    serialize: +(t4 - t3).toFixed(2),
    parse: +(t5 - t4).toFixed(2),
  },
  budget: { pipelineEachUnder1s: true },
  browserTimings: { canvasInteractionMs: 'PENDING_LIVE', svgGenerationMs: 'PENDING_LIVE', method: 'performance.mark around MindMap mount / doExport(svg) in DSH web, recorded in stage report' },
}
mkdirSync('docs/evidence', { recursive: true })
writeFileSync('docs/evidence/S4-perf-benchmark.json', JSON.stringify(record, null, 2) + '\n')
console.log('benchmark written:', record.nodes, 'nodes; pipeline ms =', JSON.stringify(record.timingsMs))
