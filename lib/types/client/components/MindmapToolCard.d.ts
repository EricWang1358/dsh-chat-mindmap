import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client';
import { type ReactElement } from 'react';
import { type CardReference } from '../card-state.js';
export declare function previewReference(block: ToolCallViewProps['block']): CardReference | null;
export declare function CardBody(props: {
    reference: CardReference | null;
    error: string | null;
    onOpen?(): void;
}): ReactElement;
export declare function MindmapToolCard({ block, sessionId }: ToolCallViewProps): ReactElement;
