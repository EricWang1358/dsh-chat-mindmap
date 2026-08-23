import { type ReactElement } from 'react';
/** Wrap an index step through a circular list of `count` items. */
export declare function cycleFocus(count: number, current: number, forward: boolean): number;
export interface SvgPreviewDialogProps {
    src: string;
    alt: string;
    onClose(): void;
}
export declare function SvgPreviewDialog(props: SvgPreviewDialogProps): ReactElement;
export declare function DialogSurface({ src, alt, onClose }: SvgPreviewDialogProps): ReactElement;
