import type { ImageExportOptions, LinkId, ResolvedChartSpecSnapshot, SheetId } from '../types';
import type {
  ImportDiagnosticDto,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
} from '@mog/types-data/data/diagnostics';
export type {
  ImportDiagnosticDetails,
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
  ImportDiagnosticPhase,
  ImportDiagnosticRecoverability,
  ImportDiagnosticSeverity,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  RuntimeOperationDiagnostic,
} from '@mog/types-data/data/diagnostics';
export type { ImportFilterUnsupportedReason } from '@mog/types-data/data/filter';

export type CellId = string;

export interface WorkbookDiagnostics {
  getFormulaReferences(
    options?: FormulaReferenceDiagnosticsOptions,
  ): Promise<FormulaReferenceDiagnosticsPage>;

  /**
   * Resolve the chart spec and data that the production chart renderer uses at
   * a given export size. This is a diagnostics surface; image export remains
   * `worksheet.charts.exportImage()`.
   */
  getResolvedChartSpec(
    options: ResolvedChartSpecDiagnosticsOptions,
  ): Promise<ResolvedChartSpecSnapshot>;

  /** Current deferred-import materialization state. */
  materialization(): Promise<MaterializationState>;

  /** Historical diagnostics produced during the most recent workbook import. */
  import(): Promise<readonly ImportDiagnosticDto[]>;

  /** Runtime operation diagnostics emitted by recent workbook commands. */
  runtime(options?: RuntimeDiagnosticsOptions): Promise<RuntimeDiagnosticsPage>;
}

export type MaterializationPhase =
  | 'MetadataParsed'
  | 'CriticalSheetHydrating'
  | 'CriticalSheetReady'
  | 'AllSheetsHydrating'
  | 'AllSheetsReady'
  | 'MaterializationFailed';

export interface MaterializationState {
  readonly phase: MaterializationPhase;
  readonly isDeferred: boolean;
  readonly isMaterialized: boolean;
  readonly pendingScope?: SheetId | 'allSheets';
  readonly initialActiveSheetId?: SheetId;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly scope?: SheetId | 'allSheets';
  };
}

export interface ResolvedChartSpecDiagnosticsOptions {
  readonly sheetId: SheetId;
  readonly chartId: string;
  readonly exportOptions?: ImageExportOptions;
}

export interface FormulaReferenceDiagnosticsOptions {
  readonly sheetId?: SheetId;
  readonly includeWarnings?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface FormulaReferenceDiagnosticsPage {
  readonly diagnostics: readonly FormulaReferenceDiagnostic[];
  readonly nextCursor?: string;
  readonly snapshotVersion: string;
}

export type FormulaReferenceDiagnostic =
  | FormulaReferenceEdgeDiagnosticRow
  | FormulaReferenceParseDiagnosticRow;

export interface FormulaReferenceBaseDiagnostic {
  readonly id: string;
  readonly sourceKind: 'cell-formula' | 'named-range-formula' | 'unsupported-formula-source';
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly location: FormulaReferenceLocation;
  readonly formula?: string;
  readonly displayValue?: string;
}

export interface FormulaReferenceEdgeDiagnosticRow extends FormulaReferenceBaseDiagnostic {
  readonly type: 'reference-edge';
  readonly kind:
    | 'deleted-cell'
    | 'deleted-range'
    | 'deleted-sheet'
    | 'missing-name'
    | 'invalid-structured-reference'
    | 'unresolved-external-reference'
    | 'external-reference-warning'
    | 'dangling-identity-target';
  readonly edge: FormulaReferenceEdgeDiagnostic;
}

export interface FormulaReferenceParseDiagnosticRow extends FormulaReferenceBaseDiagnostic {
  readonly type: 'parse';
  readonly kind: 'parse-error';
  readonly spanStart?: number;
  readonly spanEnd?: number;
  readonly sourceReason:
    | 'parser-error'
    | 'identity-template-only'
    | 'unsupported-source-representation';
}

export interface FormulaReferenceLocation {
  readonly sheetId?: SheetId;
  readonly cellId?: CellId;
  readonly address?: string;
  readonly row?: number;
  readonly col?: number;
  readonly nameId?: string;
  readonly name?: string;
  readonly addressStatus: 'resolved' | 'missing-position' | 'not-cell-backed';
}

export interface FormulaReferenceEdgeDiagnostic {
  readonly edgeId: string;
  readonly text: string;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly refIndex?: number;
  readonly targetKind: 'cell' | 'range' | 'sheet' | 'name' | 'table' | 'external';
  readonly targetDisplay?: string;
  readonly targetSheetId?: SheetId;
  readonly targetCellId?: CellId;
  readonly targetNameId?: string;
  readonly targetTableId?: string;
  readonly targetColumnName?: string;
  readonly linkId?: LinkId;
  readonly status:
    | 'missing'
    | 'deleted'
    | 'invalid'
    | 'unresolved'
    | 'loading'
    | 'stale'
    | 'denied'
    | 'broken'
    | 'ambiguous'
    | 'circular';
  readonly reason: string;
}
