import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type ReactElement } from 'react';
import type { MindmapDocument } from '../../core.js';
import { type CardReference } from '../card-state.js';
type MindmapConfig = {
    layout: string;
    density: string;
    maxNodes: number;
    theme: string;
    font: string;
    instruction: string;
    language: string;
    contextLimit: number;
};
export type MindmapPreviewPayload = {
    libraryId: string;
    revisionId: string;
    title: string;
    document: MindmapDocument;
    config: MindmapConfig;
};
export type SnapshotFetcher = (libraryId: string, revisionId: string) => Promise<MindmapPreviewPayload>;
/** Dependency injection seam (R1-4): apply() wires this to the plugin api(). */
export declare function registerSnapshotFetcher(fetcher: SnapshotFetcher): () => void;
export declare function previewReference(block: ToolCallViewProps['block']): CardReference | null;
/** Presentational body: pure function of (reference, url, error). Directly assertable via renderToStaticMarkup. */
export declare function CardBody(props: {
    reference: CardReference | null;
    url: string | null;
    error: string | null;
}): ReactElement;
export declare function MindmapToolCard({ block }: ToolCallViewProps): ReactElement;
export {};
