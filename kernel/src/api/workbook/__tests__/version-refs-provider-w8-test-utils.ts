import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createInMemoryVersionStoreProvider,
  type InMemoryVersionDocumentProviderBackend,
} from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE as PROVIDER_DOCUMENT_SCOPE,
  createWorkbook,
  initializeInput as initializeProviderInput,
} from './version-refs-provider-test-utils';

export {
  CREATED_AT,
  DOCUMENT_SCOPE,
  commitGraphChild,
  expectInitializeSuccess,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-test-utils';

export const AUX_COMMIT_ID =
  'commit:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
export const SECRET_REF_NAME = 'scenario/provider-secret';
export const SECRET_ISSUE = 'tenant-secret-issue-token';
export const SECRET_OPTION = 'internal-secret-option';
export const SECRET_CAUSE = 'postgres://secret-host/ref-conflict';
export const SECRET_MESSAGE = `provider leaked ${SECRET_REF_NAME} ${SECRET_CAUSE}`;
export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export { createWorkbook };

export async function initializeInput(graphId: string) {
  return initializeProviderInput(graphId, graphId);
}

export function createProviderWorkbook(backend: InMemoryVersionDocumentProviderBackend) {
  return createWorkbook({
    versioning: {
      provider: createInMemoryVersionStoreProvider({
        documentScope: PROVIDER_DOCUMENT_SCOPE,
        backend,
      }),
    },
  });
}

export function expectOneSuccessOneFailure(results: readonly any[]) {
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  expect(successes).toHaveLength(1);
  expect(failures).toHaveLength(1);
  if (!successes[0]?.ok || failures[0]?.ok !== false) {
    throw new Error('expected exactly one success and one failure');
  }
  return { success: successes[0], failure: failures[0] };
}

export function unsafeProviderFailure(operation: string) {
  const diagnostics = [
    {
      code: 'versionCapabilityDisabled',
      severity: 'error',
      message: SECRET_MESSAGE,
      refName: SECRET_REF_NAME,
      details: {
        cause: SECRET_CAUSE,
        issue: SECRET_ISSUE,
        missingField: SECRET_OPTION,
        mutationGuarantee: 'no-write-attempted',
        operation,
      },
    },
  ];
  return {
    ok: false,
    error: {
      code: 'versionCapabilityDisabled',
      message: SECRET_MESSAGE,
      diagnostics,
    },
    diagnostics,
  };
}

export function providerDeniedFailure() {
  const diagnostics = [
    {
      code: 'VERSION_PERMISSION_DENIED',
      severity: 'error',
      message: SECRET_MESSAGE,
      refName: SECRET_REF_NAME,
      details: {
        cause: SECRET_CAUSE,
        issue: 'providerDenied',
        mutationGuarantee: 'no-write-attempted',
      },
    },
  ];
  return {
    ok: false,
    error: {
      code: 'VERSION_PERMISSION_DENIED',
      message: SECRET_MESSAGE,
      diagnostics,
    },
    diagnostics,
  };
}
