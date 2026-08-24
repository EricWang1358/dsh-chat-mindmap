import { type MindmapDocument } from './core.js';
import { type GenerationPreviewSnapshot } from './domain/records.js';
export interface MindmapConfig {
    layout: string;
    density: 'compact' | 'standard' | 'detailed';
    maxNodes: number;
    theme: string;
    font: string;
    instruction: string;
    language: string;
    contextLimit: number;
}
export interface MindmapSource {
    kind: 'text' | 'pdf' | 'image' | 'document' | 'chat' | 'unknown';
    name?: string;
    attachmentId?: string;
    sessionId?: string;
    workspaceId?: string;
    metadata?: Record<string, string>;
}
export interface MindmapRecord {
    schemaVersion: 2;
    recordVersion: number;
    libraryId: string;
    title: string;
    workspaceKey?: string;
    current: MindmapDocument;
    previous?: MindmapDocument;
    previewCurrent?: GenerationPreviewSnapshot;
    previewPrevious?: GenerationPreviewSnapshot;
    config: MindmapConfig;
    source?: MindmapSource;
    archived?: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface MindmapSummary {
    libraryId: string;
    title: string;
    source?: MindmapSource;
    config: MindmapConfig;
    createdAt: string;
    updatedAt: string;
    hasPrevious: boolean;
    archived: boolean;
    nodeCount: number;
}
export { DEFAULT_MINDMAP_CONFIG as DEFAULT_CONFIG } from './domain/settings.js';
export declare function listMindmaps(filters?: {
    workspaceId?: string;
    sessionId?: string;
    archived?: boolean;
}): Promise<MindmapSummary[]>;
export declare function getMindmap(id: string): Promise<MindmapRecord | null>;
export declare function saveMindmap(input: {
    libraryId?: string;
    title: string;
    document: MindmapDocument;
    config?: Partial<MindmapConfig>;
    source?: MindmapSource;
    workspaceKey?: string;
    archived?: boolean;
    rotatePrevious?: boolean;
    expectedUpdatedAt?: string;
    expectedRecordVersion?: number;
}): Promise<MindmapRecord>;
export declare function updateMindmap(id: string, patch: {
    title?: string;
    document?: MindmapDocument;
    config?: Partial<MindmapConfig>;
    archived?: boolean;
    rotatePrevious?: boolean;
    expectedRecordVersion?: number;
}): Promise<MindmapRecord | null>;
export declare function restorePreviousMindmap(id: string, options?: {
    expectedRecordVersion?: number;
}): Promise<MindmapRecord | null>;
export declare function archiveMindmap(id: string, archived?: boolean): Promise<MindmapRecord | null>;
export declare function deleteMindmap(id: string, options?: {
    expectedRecordVersion?: number;
}): Promise<boolean>;
