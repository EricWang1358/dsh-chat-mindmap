import { type ReactElement } from 'react';
type MindmapGuideProps = {
    open: boolean;
    localeId?: string;
    hasMap: boolean;
    onDismiss(): void;
    onCreate(): void;
    onOpenInspector(): void;
    onOpenMore(): void;
};
/** An accessible, intentionally small walkthrough of actions the workspace already supports. */
export declare function MindmapGuide({ open, localeId, hasMap, onDismiss, onCreate, onOpenInspector, onOpenMore }: MindmapGuideProps): ReactElement | null;
export {};
