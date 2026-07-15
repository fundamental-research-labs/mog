import type { CellValuePrimitive } from '@mog/types-core/core';
import type { ImageExportOptions, LinkId, ResolvedChartSpecSnapshot, SheetId } from '../types';
import type { ChartTarget } from '../worksheet/charts';
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
  /**
   * Convenience entrypoint for agents: run every workbook-level error check
   * that can be requested from one call.
   *
   * This delegates to typed checks internally. Checks that require runtime
   * support not available in the current host return `unsupported`, not
   * `passed`, so the result stays honest.
   */
  checkErrors(options?: CheckErrorsOptions): Promise<WorkbookValidationResult>;

  /**
   * Check formula cells whose evaluated value is an Excel error such as
   * `#REF!`, `#DIV/0!`, or `#VALUE!`.
   *
   * This is intentionally narrower than whole-workbook validity. Use
   * `validateWorkbook()` to compose multiple explicit checks.
   */
  checkFormulaErrors(options?: WorkbookValidationScanOptions): Promise<WorkbookValidationResult>;

  /**
   * Same check as `checkFormulaErrors()`, named to make clear that it scans
   * evaluated formula error values rather than XML/loadability/schema issues.
   */
  checkFormulaErrorValues(
    options?: WorkbookValidationScanOptions,
  ): Promise<WorkbookValidationResult>;

  /**
   * Check external workbook references and imported external-link records for
   * unresolved, stale, denied, broken, or ambiguous link states.
   */
  checkExternalReferences(
    options?: WorkbookExternalReferenceCheckOptions,
  ): Promise<WorkbookValidationResult>;

  /**
   * Check explicit required regions for blanks. Required-region intent is
   * caller supplied; Mog does not infer it from arbitrary workbook layout.
   */
  checkBlankRegions(input: WorkbookBlankRegionCheckInput): Promise<WorkbookValidationResult>;

  /**
   * Check explicit formula-intended ranges for hardcoded values,
   * formula-like text stored as values, blanks, or mismatched expected formulas.
   */
  checkFormulaShape(input: WorkbookFormulaShapeCheckInput): Promise<WorkbookValidationResult>;

  /** Check whether the public workbook dirty flag is currently set. */
  checkWorkbookDirtyState(): Promise<WorkbookValidationResult>;

  /**
   * Check whether a saved XLSX package can be reloaded. This requires a host or
   * runtime parser callback; when unavailable, the result is `unsupported`
   * rather than a false clean bill of health.
   */
  checkOpenXmlLoadability(): Promise<WorkbookValidationResult>;

  /**
   * Check formula cached-value freshness. This requires compute/runtime support
   * for stale-cache metadata; when unavailable, the result is `unsupported`.
   */
  checkStaleCachedValues(): Promise<WorkbookValidationResult>;

  /**
   * Compose explicit validation layers. The default validates intrinsic checks
   * available without caller intent: formula error values, external references,
   * and dirty state. Required blanks and formula shape checks run only when
   * their caller-supplied ranges are provided.
   */
  validateWorkbook(options?: ValidateWorkbookOptions): Promise<WorkbookValidationResult>;

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

export type WorkbookValidationCheckKind =
  | 'formula-error-values'
  | 'external-references'
  | 'blank-regions'
  | 'formula-shape'
  | 'dirty-state'
  | 'openxml-loadability'
  | 'stale-cached-values';

export type WorkbookValidationSeverity = 'error' | 'warning' | 'info';

export type WorkbookValidationCheckStatus = 'passed' | 'failed' | 'unsupported';

export interface WorkbookValidationFinding {
  readonly id: string;
  readonly check: WorkbookValidationCheckKind;
  readonly severity: WorkbookValidationSeverity;
  readonly code: string;
  readonly message: string;
  readonly sheetId?: SheetId;
  readonly sheetName?: string;
  readonly address?: string;
  readonly range?: string;
  readonly row?: number;
  readonly col?: number;
  readonly currentValue?: CellValuePrimitive | null;
  readonly formula?: string | null;
  readonly expectedFormula?: string;
  readonly suggestedNextApiCall?: string;
  readonly details?: Record<string, unknown>;
}

export interface WorkbookValidationCheckResult {
  readonly check: WorkbookValidationCheckKind;
  readonly status: WorkbookValidationCheckStatus;
  readonly findingsCount: number;
  readonly checkedCells?: number;
  readonly checkedRanges?: number;
  readonly truncated?: boolean;
  readonly message?: string;
}

export interface WorkbookValidationResult {
  readonly ok: boolean;
  readonly checks: readonly WorkbookValidationCheckResult[];
  readonly findings: readonly WorkbookValidationFinding[];
  readonly truncated: boolean;
}

export interface WorkbookValidationRangeRequest {
  /** Sheet id to validate. Required unless `sheetName` or a sheet-qualified range is supplied. */
  readonly sheetId?: SheetId;
  /** Sheet display name to validate. Ignored when `sheetId` is supplied. */
  readonly sheetName?: string;
  /** A1 range, optionally sheet-qualified, e.g. `"Inputs!B2:D10"`. */
  readonly range: string;
  /** Optional caller label surfaced in validation findings. */
  readonly label?: string;
}

export interface WorkbookValidationScanOptions {
  /** Limit findings returned. Defaults to an implementation-defined safe page size. */
  readonly limit?: number;
  /** Sheet id to scan. Omit both sheet and range to scan every sheet's used range. */
  readonly sheetId?: SheetId;
  /** Sheet display name to scan. Ignored when `sheetId` is supplied. */
  readonly sheetName?: string;
  /** A1 range to scan. May be sheet-qualified. */
  readonly range?: string;
  /** Multiple explicit ranges to scan. Overrides `sheetId`/`sheetName`/`range`. */
  readonly ranges?: readonly WorkbookValidationRangeRequest[];
}

export interface WorkbookExternalReferenceCheckOptions {
  /** Include external-reference warnings as well as errors. Defaults to true. */
  readonly includeWarnings?: boolean;
  /** Limit findings returned. Defaults to an implementation-defined safe page size. */
  readonly limit?: number;
}

export interface WorkbookBlankRegionCheckInput {
  readonly ranges: readonly WorkbookValidationRangeRequest[];
  /** Treat whitespace-only strings as blank. Defaults to true. */
  readonly treatWhitespaceAsBlank?: boolean;
  /** Limit findings returned. Defaults to an implementation-defined safe page size. */
  readonly limit?: number;
}

export interface WorkbookFormulaShapeRangeRequest extends WorkbookValidationRangeRequest {
  /** Expected formula text for every non-blank cell in the range. */
  readonly expectedFormula?: string;
  /** Allow blank cells in the formula-intended range. Defaults to false. */
  readonly allowBlanks?: boolean;
  /** Allow non-formula constants in the formula-intended range. Defaults to false. */
  readonly allowConstants?: boolean;
}

export interface WorkbookFormulaShapeCheckInput {
  readonly ranges: readonly WorkbookFormulaShapeRangeRequest[];
  /** Limit findings returned. Defaults to an implementation-defined safe page size. */
  readonly limit?: number;
}

export interface ValidateWorkbookOptions {
  /** Defaults to true. */
  readonly includeFormulaErrorValues?: boolean;
  /** Defaults to true. */
  readonly includeExternalReferences?: boolean;
  /** Defaults to true. */
  readonly includeDirtyState?: boolean;
  /** Defaults to false because this requires parser/runtime support. */
  readonly includeOpenXml?: boolean;
  /** Defaults to false because this requires stale-cache metadata support. */
  readonly includeStaleValues?: boolean;
  readonly formulaErrorValues?: WorkbookValidationScanOptions;
  readonly externalReferences?: WorkbookExternalReferenceCheckOptions;
  readonly blankRegions?: WorkbookBlankRegionCheckInput;
  readonly formulaShape?: WorkbookFormulaShapeCheckInput;
}

export type CheckErrorsOptions = ValidateWorkbookOptions;

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

interface ResolvedChartSpecDiagnosticsOptionsBase {
  readonly sheetId: SheetId;
  readonly exportOptions?: ImageExportOptions;
}

export type ResolvedChartSpecDiagnosticsOptions = ResolvedChartSpecDiagnosticsOptionsBase &
  (
    | { readonly chartTarget: ChartTarget; readonly chartId?: never }
    | {
        /** @deprecated Use `chartTarget`; retained as an ID-only compatibility alias. */
        readonly chartId: string;
        readonly chartTarget?: never;
      }
  );

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
