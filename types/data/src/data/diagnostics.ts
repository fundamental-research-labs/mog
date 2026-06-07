import type { ImportFilterUnsupportedReason } from './filter';

export type ImportDiagnosticSeverity = 'info' | 'warning' | 'error' | 'fatal';

export type ImportDiagnosticRecoverability =
  | 'fullySupported'
  | 'repaired'
  | 'partiallySupported'
  | 'preservedNotRenderable'
  | 'preservedNotEditable'
  | 'unsupportedPreserved'
  | 'unsupportedDropped'
  | 'malformedDropped'
  | 'securityDisabled';

export type ImportDiagnosticPhase = 'parser' | 'criticalSheet' | 'fullHydration';

export interface ImportDiagnosticLocation {
  sheet?: string;
  cell?: string;
  sheetIndex?: number;
  sheetName?: string;
  sourceRange?: string;
  row?: number;
  col?: number;
  cellRef?: string;
  objectId?: string;
  filterColId?: number;
  tableColumnOrdinal?: number;
  unresolvedFilterColId?: number;
  unresolvedTableColumnOrdinal?: number;
}

export interface UnsupportedFilterImportDiagnosticDetails {
  kind: 'unsupportedFilter';
  reasons: readonly ImportFilterUnsupportedReason[];
  filterId?: string;
  filterKind?: 'autoFilter' | 'tableFilter' | 'advancedFilter';
  sourceKey?: string;
  filterColId?: number;
  tableColumnOrdinal?: number;
  resolvedCol?: number;
}

export type ImportDiagnosticDetails =
  | UnsupportedFilterImportDiagnosticDetails
  | Record<string, unknown>;

export interface ImportDiagnosticDto {
  id: string;
  code: string;
  severity: ImportDiagnosticSeverity;
  feature: string;
  recoverability: ImportDiagnosticRecoverability | string;
  message: string;
  reason?: string;
  details?: ImportDiagnosticDetails;
  reference?: ImportDiagnosticLocation;
  location?: ImportDiagnosticLocation;
  importPhases?: readonly ImportDiagnosticPhase[];
  firstImportPhase?: ImportDiagnosticPhase;
}

export interface RuntimeDiagnosticsOptions {
  sinceSequence?: string;
  limit?: number;
}

export interface RuntimeDiagnosticsPage {
  diagnostics: readonly RuntimeOperationDiagnostic[];
  nextSequence?: string;
  truncated: boolean;
}

export interface RuntimeOperationDiagnostic {
  id: string;
  sequence: string;
  code: string;
  severity: 'warning' | 'error';
  recoverability: string;
  operation: string;
  sheetId: string;
  filterId?: string;
  filterKind?: 'autoFilter' | 'tableFilter' | 'advancedFilter';
  tableId?: string;
  reason?: string;
  reasons?: readonly string[];
  details?: unknown;
  location?: unknown;
}
