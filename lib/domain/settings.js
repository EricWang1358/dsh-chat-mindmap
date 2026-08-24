export const DEFAULT_MINDMAP_CONFIG = {
    layout: 'logicalStructure',
    density: 'standard',
    maxNodes: 360,
    theme: 'default',
    font: 'system',
    instruction: '',
    language: 'auto',
    contextLimit: 80_000,
};
const MAX_SETTING_STRING_LENGTH = 80;
export const DEFAULT_SETTINGS = {
    defaultLayout: DEFAULT_MINDMAP_CONFIG.layout,
    defaultTheme: DEFAULT_MINDMAP_CONFIG.theme,
    defaultDensity: DEFAULT_MINDMAP_CONFIG.density,
    defaultMaxNodes: DEFAULT_MINDMAP_CONFIG.maxNodes,
    defaultContextLimit: DEFAULT_MINDMAP_CONFIG.contextLimit,
    defaultLanguage: DEFAULT_MINDMAP_CONFIG.language,
    focusGeneratedMap: false,
    onboardingSeen: false,
};
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value, fallback, maxLength = MAX_SETTING_STRING_LENGTH) {
    return typeof value === 'string' && value.trim().length > 0 ? value.slice(0, maxLength) : fallback;
}
function clampedNumber(value, fallback, min, max) {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}
export function normalizeMindmapSettings(value) {
    const input = isRecord(value) ? value : {};
    const density = input.defaultDensity === 'compact' || input.defaultDensity === 'detailed' ? input.defaultDensity : DEFAULT_SETTINGS.defaultDensity;
    return {
        defaultLayout: boundedString(input.defaultLayout, DEFAULT_SETTINGS.defaultLayout),
        defaultTheme: boundedString(input.defaultTheme, DEFAULT_SETTINGS.defaultTheme),
        defaultDensity: density,
        defaultMaxNodes: clampedNumber(input.defaultMaxNodes, DEFAULT_SETTINGS.defaultMaxNodes, 8, 2_000),
        defaultContextLimit: clampedNumber(input.defaultContextLimit, DEFAULT_SETTINGS.defaultContextLimit, 8_000, 200_000),
        defaultLanguage: boundedString(input.defaultLanguage, DEFAULT_SETTINGS.defaultLanguage, 32),
        focusGeneratedMap: input.focusGeneratedMap === true,
        onboardingSeen: input.onboardingSeen === true,
    };
}
/**
 * Settings only ever merge into the config of a newly created record. Existing
 * record configs are never passed through this function, so global setting
 * changes can never rewrite an already saved mindmap.
 */
export function resolveNewRecordConfig(settings, requestConfig) {
    const request = isRecord(requestConfig) ? requestConfig : {};
    return {
        layout: typeof request.layout === 'string' && request.layout.trim().length > 0 ? request.layout.slice(0, MAX_SETTING_STRING_LENGTH) : settings.defaultLayout,
        theme: typeof request.theme === 'string' && request.theme.trim().length > 0 ? request.theme.slice(0, MAX_SETTING_STRING_LENGTH) : settings.defaultTheme,
        density: request.density === 'compact' || request.density === 'detailed' ? request.density : settings.defaultDensity,
        maxNodes: typeof request.maxNodes === 'number' && Number.isFinite(request.maxNodes) ? Math.max(8, Math.min(2_000, Math.floor(request.maxNodes))) : settings.defaultMaxNodes,
        contextLimit: typeof request.contextLimit === 'number' && Number.isFinite(request.contextLimit) ? Math.max(8_000, Math.min(200_000, Math.floor(request.contextLimit))) : settings.defaultContextLimit,
        language: typeof request.language === 'string' && request.language.trim().length > 0 ? request.language.slice(0, 32) : settings.defaultLanguage,
        font: typeof request.font === 'string' && request.font.trim().length > 0 ? request.font.slice(0, MAX_SETTING_STRING_LENGTH) : DEFAULT_MINDMAP_CONFIG.font,
        instruction: typeof request.instruction === 'string' ? request.instruction.slice(0, 4_000) : DEFAULT_MINDMAP_CONFIG.instruction,
    };
}
