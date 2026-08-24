// W6 i18n: chat-mindmap namespace dictionaries (§14).
// Static chrome copy only - user titles/nodes/instructions never enter here.
export type LocaleDict = Record<string, string>

export const DICTS: Record<'zh' | 'en', LocaleDict> = {
  zh: {
    'empty.session.title': '当前会话暂无脑图',
    'empty.session.body': '点击“＋”新建，或在聊天里让 Agent 从文本/PDF/附件生成。',
    'empty.session.kicker': '从一段内容，到一张可编辑的脑图',
    'empty.session.primary': '从文本新建脑图',
    'empty.session.guideTitle': '三步开始',
    'empty.session.guideAction': '查看使用指南',
    'empty.session.step1.title': '在对话中生成',
    'empty.session.step1.body': '让 Agent 根据文本、附件或上下文整理结构。',
    'empty.session.step2.title': '在这里继续编辑',
    'empty.session.step2.body': '拖拽、改名和补充备注，修改会自动保存。',
    'empty.session.step3.title': '按需导出分享',
    'empty.session.step3.body': '在“更多”中导出 PNG、Markdown、JSON 或 XMind。',
    'empty.workspace.title': '当前工作区暂无脑图',
    'empty.workspace.body': '切回“本会话”查看当前会话脑图，或点击“＋”新建。',
    'empty.capability.title': '脑图能力不可用',
    'empty.capability.body': '脑图服务未就绪或当前部署缺少所需能力，请稍后重试。',
    'guide.label': '脑图使用指南',
    'guide.title': '脑图工作台指南',
    'guide.close': '关闭使用指南',
    'guide.progress': '第 {current} 步，共 {total} 步',
    'guide.progressNav': '指南步骤',
    'guide.stage.generate.nav': '生成脑图',
    'guide.stage.generate.title': '从一段内容开始',
    'guide.stage.generate.body': '粘贴文本或 Markdown 立即创建；也可以回到聊天，让 Agent 根据当前上下文或附件生成。',
    'guide.stage.generate.primary': '从文本创建',
    'guide.stage.refine.nav': '整理结构',
    'guide.stage.refine.title': '在画布里继续思考',
    'guide.stage.refine.body': '选择节点后打开属性，修改标题、备注和图的布局。所有手动编辑都会自动保存。',
    'guide.stage.refine.primary': '打开节点属性',
    'guide.stage.export.nav': '导出交付',
    'guide.stage.export.title': '以合适的格式交付',
    'guide.stage.export.body': '在更多操作中导出 PNG、Markdown、JSON 或 XMind；需要时也能归档、恢复版本或重新生成。',
    'guide.stage.export.primary': '打开更多操作',
    'guide.requiresMap': '先创建或打开一张脑图，即可直接演练这一步。',
    'guide.back': '上一步',
    'guide.continue': '继续',
    'guide.finish': '完成',
    'guide.skip': '跳过引导',
    'regen.label': '重新生成',
    'regen.note.label': '补充要求（可选）',
    'regen.note.placeholder': '例如：更精简、突出方法步骤、补充例子',
    'regen.source.missing': '来源不可用：本图没有可复解析的来源，重新生成只能基于当前大纲与备注。',
    'common.cancel': '取消',
    'settings.notReady': '设置尚未就绪。',
    'status.autosaved': '已自动保存当前手动修改',
  },
  en: {
    'empty.session.title': 'No mind maps in this session yet',
    'empty.session.body': 'Click “+” to create one, or ask an agent to build from text/PDF/attachments.',
    'empty.session.kicker': 'From a source to an editable mind map',
    'empty.session.primary': 'Create from text',
    'empty.session.guideTitle': 'Start in three steps',
    'empty.session.guideAction': 'View guide',
    'empty.session.step1.title': 'Generate in chat',
    'empty.session.step1.body': 'Ask an agent to structure text, attachments, or conversation context.',
    'empty.session.step2.title': 'Refine it here',
    'empty.session.step2.body': 'Rearrange, rename, and annotate. Your edits save automatically.',
    'empty.session.step3.title': 'Export when ready',
    'empty.session.step3.body': 'Use More to export PNG, Markdown, JSON, or XMind.',
    'empty.workspace.title': 'No mind maps in this workspace yet',
    'empty.workspace.body': 'Switch back to “This session”, or click “+” to create one.',
    'empty.capability.title': 'Mindmap capability unavailable',
    'empty.capability.body': 'The mindmap service is not ready or this deployment lacks it. Try again later.',
    'guide.label': 'Mindmap guide',
    'guide.title': 'Mindmap workspace guide',
    'guide.close': 'Close guide',
    'guide.progress': 'Step {current} of {total}',
    'guide.progressNav': 'Guide steps',
    'guide.stage.generate.nav': 'Generate',
    'guide.stage.generate.title': 'Start with one source',
    'guide.stage.generate.body': 'Paste text or Markdown to create a map now, or return to chat and ask an agent to use the current context or attachments.',
    'guide.stage.generate.primary': 'Create from text',
    'guide.stage.refine.nav': 'Refine',
    'guide.stage.refine.title': 'Keep thinking on the canvas',
    'guide.stage.refine.body': 'Select a node, then open Properties to edit its title, note, layout, and appearance. Manual edits save automatically.',
    'guide.stage.refine.primary': 'Open properties',
    'guide.stage.export.nav': 'Export',
    'guide.stage.export.title': 'Deliver in the right format',
    'guide.stage.export.body': 'More can export PNG, Markdown, JSON, or XMind. It also keeps archive, restore, and regeneration close at hand.',
    'guide.stage.export.primary': 'Open More',
    'guide.requiresMap': 'Create or open a mind map first to try this step directly.',
    'guide.back': 'Back',
    'guide.continue': 'Continue',
    'guide.finish': 'Finish',
    'guide.skip': 'Skip guide',
    'regen.label': 'Regenerate',
    'regen.note.label': 'Extra requirements (optional)',
    'regen.note.placeholder': 'e.g. tighter outline, highlight steps, add examples',
    'regen.source.missing': 'Source unavailable: regeneration will rely on the current outline and notes only.',
    'common.cancel': 'Cancel',
    'settings.notReady': 'Settings are not ready yet.',
    'status.autosaved': 'Changes saved automatically',
  },
}

/** Unknown/missing locales fall back to English (§14). */
export function createT(localeId: string | undefined): (key: string, params?: Record<string, string | number>) => string {
  const dict = /^zh\b/i.test(localeId ?? '') ? DICTS.zh : DICTS.en
  return (key, params) => {
    let out = dict[key] ?? DICTS.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) out = out.split('{' + k + '}').join(String(v))
    }
    return out
  }
}

/** Resolution chain: official locale service value -> navigator language -> en. */
export function resolveLocale(serviceLocale: string | undefined, navigatorLanguage: string | undefined): 'zh' | 'en' {
  const candidate = (serviceLocale ?? navigatorLanguage ?? '').toLowerCase()
  return candidate.startsWith('zh') ? 'zh' : 'en'
}
