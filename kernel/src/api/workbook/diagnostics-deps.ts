import type { WorkbookValidationResult } from '@mog-sdk/contracts/api';

export interface WorkbookDiagnosticsDeps {
  readonly isDirty?: () => boolean;
  readonly checkOpenXmlLoadability?: () => Promise<WorkbookValidationResult>;
  readonly checkStaleCachedValues?: () => Promise<WorkbookValidationResult>;
}
