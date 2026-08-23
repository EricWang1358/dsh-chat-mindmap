import type { MindmapConfig } from '../library.js';
export declare const DEFAULT_MINDMAP_CONFIG: MindmapConfig;
export interface MindmapSettings {
    defaultLayout: string;
    defaultTheme: string;
    defaultDensity: MindmapConfig['density'];
    defaultMaxNodes: number;
    defaultContextLimit: number;
    defaultLanguage: string;
    focusGeneratedMap: boolean;
}
export declare const DEFAULT_SETTINGS: MindmapSettings;
export declare function normalizeMindmapSettings(value?: unknown): MindmapSettings;
/**
 * Settings only ever merge into the config of a newly created record. Existing
 * record configs are never passed through this function, so global setting
 * changes can never rewrite an already saved mindmap.
 */
export declare function resolveNewRecordConfig(settings: MindmapSettings, requestConfig?: Partial<MindmapConfig>): MindmapConfig;
