import { versionStoreDiagnostic } from './provider-diagnostics';
import { VersionStoreProviderError } from './provider-error';
import { failedStoreResult } from './provider-results';
import type {
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreOperation,
} from './provider-types';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

export function assertInMemoryProviderAvailable(
  state: InMemoryVersionStoreProviderState,
  operation: VersionStoreOperation,
): void {
  if (state.lifecycleState !== 'open') {
    throw new VersionStoreProviderError(
      inMemoryProviderLifecycleUnavailableDiagnostic(state, operation),
    );
  }
  if (state.mode !== 'unavailable') return;

  throw new VersionStoreProviderError(
    versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
      operation,
      documentScope: state.documentScope,
      recoverability: 'retry',
      safeMessage: 'Version store provider is unavailable.',
    }),
  );
}

export function inMemoryProviderWriteUnavailableFailure(
  state: InMemoryVersionStoreProviderState,
  operation: VersionStoreOperation,
): VersionStoreFailure | null {
  if (state.lifecycleState !== 'open') {
    return failedStoreResult(
      [inMemoryProviderLifecycleUnavailableDiagnostic(state, operation)],
      'no-write-attempted',
      true,
    );
  }

  if (state.mode === 'unavailable') {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
          operation,
          documentScope: state.documentScope,
          recoverability: 'retry',
          safeMessage: 'Version store provider is unavailable.',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  if (!state.capabilities.writes.initializeGraph) {
    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
          operation,
          documentScope: state.documentScope,
          safeMessage: 'Version store provider is opened read-only.',
        }),
      ],
      'no-write-attempted',
    );
  }

  return null;
}

export function inMemoryProviderLifecycleUnavailableDiagnostic(
  state: InMemoryVersionStoreProviderState,
  operation: VersionStoreOperation,
): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
    operation,
    documentScope: state.documentScope,
    recoverability: 'retry',
    lifecycleState: state.lifecycleState,
    safeMessage: 'Version store provider is closed or disposing.',
  });
}
