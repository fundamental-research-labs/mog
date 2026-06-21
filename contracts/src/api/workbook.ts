/**
 * Re-export shim. Source lives in @mog/types-api (types/api/src/api/workbook.ts).
 */
export type * from '@mog/types-api/api/workbook';
export type {
  WorkbookVersion,
  WorkbookVersionCapabilityStage,
  WorkbookVersionCapabilityStatus,
  WorkbookVersionDependency,
  WorkbookVersionDiagnostic,
  WorkbookVersionDiagnosticCode,
  WorkbookVersionDiagnosticSeverity,
  WorkbookVersionHead,
  WorkbookVersionHeadStatus,
  WorkbookVersionRolloutStage,
  WorkbookVersionStatus,
} from '@mog/types-api/api/workbook/version';
