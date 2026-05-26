import type { CellRenderInfo } from './types';

export interface CenterAcrossSourceCell extends CellRenderInfo {
  richTextRuns?: readonly unknown[];
  hyperlink?: unknown;
  conditionalFontColorOverride?: string | null;
  measurementKey?: string;
}

export interface CenterAcrossRenderSpan {
  row: number;
  sourceCol: number;
  startCol: number;
  endCol: number;
  sourceCell: CenterAcrossSourceCell;
}

export interface CenterAcrossSpanProvider {
  getCenterAcrossSpans(
    paneId: string,
    row: number,
    startCol: number,
    endCol: number,
  ): readonly CenterAcrossRenderSpan[];
}
