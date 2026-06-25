import { versionStoreDiagnostic } from './provider-diagnostics';
import type { VersionDocumentIntegrityScanOptions, VersionIntegrityReport } from './provider-types';
import { assertInMemoryProviderAvailable } from './provider-in-memory-availability';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

export async function scanInMemoryDocumentIntegrity(
  state: InMemoryVersionStoreProviderState,
  _options: VersionDocumentIntegrityScanOptions = {},
): Promise<VersionIntegrityReport> {
  assertInMemoryProviderAvailable(state, 'scanDocumentIntegrity');

  if (!state.capabilities.integrityScan || !state.capabilities.reads.integrityReports) {
    return {
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      scanScope: 'document',
      diagnostics: [
        versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
          operation: 'scanDocumentIntegrity',
          documentScope: state.documentScope,
          recoverability: 'unsupported',
          safeMessage: 'Document integrity scans are not supported by this provider.',
        }),
      ],
    };
  }

  return {
    status: 'ok',
    checkedAt: new Date().toISOString(),
    scanScope: 'document',
    diagnostics: [],
  };
}
