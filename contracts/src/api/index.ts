/**
 * Public API contract barrel.
 *
 * Runtime values are projected from local contracts source; type-only API
 * interfaces are still authored in private shards and rolled into public d.ts.
 */
export type {
  Workbook,
  WorkbookInternal,
  CalculateOptions,
  CalculateResult,
  CustomList,
  WorkbookLinkStatusScope,
  WorkbookCustomListInput,
  WorkbookCustomListUpdate,
} from './workbook';
export type { Worksheet, WorksheetWithInternals } from './worksheet';
export type * from '@mog/types-api/api';
export type {
  ImportDiagnosticDetails,
  ImportDiagnosticDto,
  ImportDiagnosticLocation,
  ImportDiagnosticPhase,
  ImportDiagnosticRecoverability,
  ImportDiagnosticSeverity,
  ImportFilterUnsupportedReason,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  RuntimeOperationDiagnostic,
} from '@mog/types-api/api/workbook/diagnostics';
export { CellType, CellValueType, NumberFormatCategory, RangeValueType } from './types';
export {
  isFloatingObjectMutationReceipt,
  isFloatingObjectReceipt,
  isFloatingObjectRemoveReceipt,
} from './mutation-receipt';
export {
  clampIndent,
  MAX_INDENT_LEVEL,
  officeJsAngleToOoxmlRotation,
  officeJsPatternToOoxml,
  ooxmlPatternToOfficeJs,
  ooxmlRotationToOfficeJsAngle,
} from './worksheet/format-mappings';
