import type { DocumentImportWarning } from '@mog-sdk/contracts/document';
import type { WorkbookConfig } from './types';

export function resolveWorkbookImportWarnings(
  config: Pick<WorkbookConfig, 'importWarnings'>,
): readonly DocumentImportWarning[] {
  return config.importWarnings ?? [];
}
