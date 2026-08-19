export interface MindmapNode {
    id: string;
    title: string;
    note?: string;
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
export declare function buildMindmap(context: string, title?: string): MindmapDocument;
export declare function flattenNode(node: MindmapNode): Array<{
    title: string;
    depth: number;
}>;
