// W6 i18n: chat-mindmap namespace dictionaries (§14).
// Static chrome copy only - user titles/nodes/instructions never enter here.
export type LocaleDict = Record<string, string>

export const DICTS: Record<'zh' | 'en', LocaleDict> = {
  zh: {
    'empty.session.title': '当前会话暂无脑图',
    'empty.session.body': '点击“＋”新建，或在聊天里让 Agent 从文本/PDF/附件生成。',
    'empty.workspace.title': '当前工作区暂无脑图',
    'empty.workspace.body': '切回“本会话”查看当前会话脑图，或点击“＋”新建。',
    'empty.capability.title': '脑图能力不可用',
    'empty.capability.body': '脑图服务未就绪或当前部署缺少所需能力，请稍后重试。',
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
    'empty.workspace.title': 'No mind maps in this workspace yet',
    'empty.workspace.body': 'Switch back to “This session”, or click “+” to create one.',
    'empty.capability.title': 'Mindmap capability unavailable',
    'empty.capability.body': 'The mindmap service is not ready or this deployment lacks it. Try again later.',
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
