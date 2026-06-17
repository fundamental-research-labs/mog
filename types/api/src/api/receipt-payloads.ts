import type { CellValue, SheetId } from '@mog/types-core/core';
import type { PivotMemberRef, PivotValueRecord } from '@mog/types-data/data/pivot';

export type LinkId = string;

export interface RichTextRun {
  text: string;
  fontName: string | null;
  fontSize: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string | null;
  colorIndexed?: number;
  colorTheme?: number;
  colorTint?: number;
  charset: number | null;
  family: number | null;
  scheme: string | null;
  vertAlign?: string;
  preserveSpace?: boolean;
}

export interface Comment {
  id: string;
  cellRef: string;
  author: string;
  authorId?: string;
  authorEmail?: string;
  content: string | null;
  runs: RichTextRun[];
  threadId: string | null;
  parentId: string | null;
  personId?: string;
  resolved?: boolean;
  timestamp?: string;
  createdAt: number | null;
  modifiedAt: number | null;
  xrUid?: string;
  shapeId?: number;
  extLstXml?: string;
  contentType?: CommentContentType;
  mentions?: CommentMention[];
  commentType: CommentType;
  visible?: boolean;
  noteHeight?: number;
  noteWidth?: number;
}

export interface CommentMention {
  displayText: string;
  userId: string;
  email?: string;
  startIndex: number;
  length: number;
}

export type CommentType = 'note' | 'threadedComment';
export type CommentContentType = 'plain' | 'mention';

export interface TableUpdateOptions {
  style?: string;
  name?: string;
  emphasizeFirstColumn?: boolean;
  emphasizeLastColumn?: boolean;
  bandedColumns?: boolean;
  bandedRows?: boolean;
  showFilterButtons?: boolean;
  hasHeaderRow?: boolean;
  hasTotalsRow?: boolean;
  autoExpand?: boolean;
  autoCalculatedColumns?: boolean;
}

export interface TableInfo {
  id: string;
  name: string;
  displayName: string;
  sheetId: string;
  range: string;
  columns: TableColumn[];
  hasHeaderRow: boolean;
  hasTotalsRow: boolean;
  style: string;
  bandedRows: boolean;
  bandedColumns: boolean;
  emphasizeFirstColumn: boolean;
  emphasizeLastColumn: boolean;
  showFilterButtons: boolean;
  autoExpand: boolean;
  autoCalculatedColumns: boolean;
}

export interface TableColumn {
  id: string;
  name: string;
  index: number;
  totalsFunction: TotalsFunction | null;
  totalsLabel: string | null;
  calculatedFormula?: string;
}

export type TotalsFunction =
  | 'average'
  | 'count'
  | 'countNums'
  | 'max'
  | 'min'
  | 'stdDev'
  | 'sum'
  | 'var'
  | 'custom'
  | 'none';

export interface PivotQueryRecord {
  dimensions: Record<string, CellValue>;
  values: Record<string, CellValue>;
  valueRecords?: PivotValueRecord[];
  rowMemberPath?: PivotMemberRef[];
  columnMemberPath?: PivotMemberRef[];
}

export interface PivotQueryResult {
  pivotName: string;
  rowFields: string[];
  columnFields: string[];
  valueFields: string[];
  records: PivotQueryRecord[];
  sourceRowCount: number;
}

export interface SlicerInfo {
  id: string;
  name: string;
  caption: string;
  tableName: string;
  columnName: string;
  source?: { type: 'table' | 'pivot' };
  sourceType?: 'timeline';
}

export interface Slicer extends SlicerInfo {
  selectedItems: CellValue[];
  position: { x: number; y: number; width: number; height: number };
}

export interface OriginalCellValue {
  sheetId: SheetId;
  cellId: string;
  value: string | number | boolean | null;
  formula?: string;
}

export interface ApplyScenarioResult {
  baselineId: string;
  documentId?: string;
  cellsUpdated: number;
  skippedCells: string[];
  originalValues: OriginalCellValue[];
}

export type LinkStatus =
  | 'unresolved'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'denied'
  | 'broken'
  | 'ambiguous';

export type LinkStatusReason =
  | 'wrongWorkbookId'
  | 'missingTarget'
  | 'unsupportedLinkKind'
  | 'permissionDenied'
  | 'sourceUnavailable';

export interface LinkStatusView {
  readonly linkId: LinkId;
  readonly status: LinkStatus;
  readonly statusReason?: LinkStatusReason;
  readonly lastResolvedAt?: string;
  readonly cachedValuesVersion?: string;
  readonly canRefresh: boolean;
  readonly retryable: boolean;
  readonly displayMessage: string;
}
