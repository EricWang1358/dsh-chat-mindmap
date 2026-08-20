export interface MindmapNode {
    id: string;
    title: string;
    note?: string;
    /** Persisted UI state. False/absent means expanded. */
    collapsed?: boolean;
    children?: MindmapNode[];
}
export interface MindmapDocument {
    version: 1;
    title: string;
    root: MindmapNode;
    source: {
        kind: 'agent-context';
        characters: number;
        generatedAt: string;
    };
}
export interface MindmapBuildOptions {
    contextLimit?: number;
    maxNodes?: number;
    maxDepth?: number;
    maxChildren?: number;
}
export interface MindmapValidationLimits {
    maxNodes?: number;
    maxDepth?: number;
    maxTitleLength?: number;
    maxNoteLength?: number;
}
export declare function buildMindmap(context: string, title?: string, options?: MindmapBuildOptions): MindmapDocument;
export declare function buildMindmapFromOutline(outline: string, title?: string, options?: MindmapBuildOptions): MindmapDocument;
export declare function countMindmapNodes(node: MindmapNode): number;
export declare function mindmapToMarkdown(node: MindmapNode): string;
export declare function validateMindmapDocument(value: unknown, options?: MindmapValidationLimits): MindmapDocument;
export declare function flattenNode(node: MindmapNode): Array<{
    title: string;
    depth: number;
}>;
