import { expect, jest } from '@jest/globals';

import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../context';
import { checkoutRebindIdentityDiagnosticDetails } from '../version/checkout/version-checkout-rebind';

export const PROVIDER_DOCUMENT_ID = 'provider-rebind-doc';
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const MOVED_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const SECRET_BRANCH = 'scenario/rebind-secret';

const CREATED_AT = '2026-06-23T00:00:00.000Z';

export const OPERATION_CONTEXT: VersionOperationContext = Object.freeze({
  operationId: 'workbook.version.checkout:1782345600000:1',
  kind: 'mutation',
  author: Object.freeze({
    authorId: 'user-redacted-by-diagnostics',
    actorKind: 'user',
  }),
  createdAt: CREATED_AT,
  workbookId: 'workbook-redacted-by-diagnostics',
  domainIds: Object.freeze(['workbook.version.checkout']),
  capturePolicy: 'commitEligible',
  writeAdmissionMode: 'capture',
});

export function createDocumentContext(
  overrides: Record<string, unknown> = {},
): DocumentContext & { versioning?: unknown } {
  return {
    computeBridge: createComputeBridgeMock(),
    ...overrides,
  } as unknown as DocumentContext & { versioning?: unknown };
}

function createComputeBridgeMock(docId?: string, semanticWorkbookId = docId) {
  return {
    ...(docId ? { core: { docId } } : {}),
    encodeDiff: jest.fn(async () => new Uint8Array([0x01])),
    semanticWorkbookStateEnvelope: jest.fn(async () => ({
      state: {
        ...(semanticWorkbookId ? { workbookId: semanticWorkbookId } : {}),
        sheets: {},
      },
      stateDigest: { algorithm: 'sha256', digest: '0'.repeat(64) },
    })),
    diffSemanticWorkbookStates: jest.fn(async () => ({ changes: [] })),
  };
}

export function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected checkout rebind to throw.');
}

export function expectDiagnosticDetailsNotToLeak(
  error: unknown,
  forbiddenTokens: readonly string[],
): void {
  const details = checkoutRebindIdentityDiagnosticDetails(error);
  expect(details).not.toBeNull();
  const serialized = JSON.stringify(details);
  for (const token of forbiddenTokens) {
    expect(serialized).not.toContain(token);
  }
}
