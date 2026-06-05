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
