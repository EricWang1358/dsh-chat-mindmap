import { type MindmapDocument } from './core.js';
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
    libraryId: string;
    title: string;
    current: MindmapDocument;
    previous?: MindmapDocument;
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
export declare const DEFAULT_CONFIG: MindmapConfig;
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
    archived?: boolean;
    rotatePrevious?: boolean;
}): Promise<MindmapRecord>;
export declare function updateMindmap(id: string, patch: {
    title?: string;
    document?: MindmapDocument;
    config?: Partial<MindmapConfig>;
    archived?: boolean;
    rotatePrevious?: boolean;
}): Promise<MindmapRecord | null>;
export declare function archiveMindmap(id: string, archived?: boolean): Promise<MindmapRecord | null>;
export declare function deleteMindmap(id: string): Promise<boolean>;
