import type { DocumentImportOptions, DocumentImportWarning } from '@mog-sdk/contracts/document';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import type { DocumentLifecycleSystem } from '../../document';
import type { DocumentWorkbookVersioningLifecycleConfig } from '../../document/version-store/lifecycle';
import type { XlsxVersionImportRootProvenance } from '../../document/version-store/xlsx-import-root';
import type { KernelClock } from '../../context';
import type { DocumentHandleInternal } from './document-handle-types';

export type XlsxDocumentImportEnvironment = 'browser' | 'headless';

export type XlsxDocumentImportOptions = DocumentImportOptions & {
  environment?: XlsxDocumentImportEnvironment;
  napiAddon?: unknown;
  security?: DocumentSecurityConfig;
  userTimezone?: string;
  versioning?: Pick<DocumentWorkbookVersioningLifecycleConfig, 'provider' | 'providerSelection'>;
};

export type XlsxDocumentHandleFactory<THandle extends DocumentHandleInternal> = (
  documentId: string,
  lifecycle: DocumentLifecycleSystem,
  context: ISpreadsheetKernelContext,
  collaborationBootstrap?: undefined,
  importWarnings?: readonly DocumentImportWarning[],
  xlsxImportRoot?: XlsxVersionImportRootProvenance,
) => THandle;

export interface XlsxDocumentImportDependencies<THandle extends DocumentHandleInternal> {
  generateDocumentId(): string;
  clock: KernelClock;
  createDocumentHandle: XlsxDocumentHandleFactory<THandle>;
}
