import { jest } from '@jest/globals';

import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../context';
import {
  checkoutRebindIdentityDiagnosticDetails,
  rebindVersioningAfterCheckout,
} from '../version-checkout-rebind';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const MOVED_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const SECRET_BRANCH = 'scenario/rebind-secret';
const CREATED_AT = '2026-06-23T00:00:00.000Z';

const OPERATION_CONTEXT: VersionOperationContext = Object.freeze({
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

describe('version checkout rebind hardening', () => {
  it('passes caller-supplied operation context to semantic capture reset', () => {
    const resetNormalCaptureForCheckout = jest.fn();
    const nextContext = createDocumentContext();

    rebindVersioningAfterCheckout({
      versioning: {
        semanticMutationCapture: {
          resetNormalCaptureForCheckout,
        },
      },
      nextContext,
      operationContext: OPERATION_CONTEXT,
    });

    expect(resetNormalCaptureForCheckout).toHaveBeenCalledTimes(1);
    expect(resetNormalCaptureForCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        semanticStateReader: expect.objectContaining({
          readCurrentSemanticState: expect.any(Function),
          diffSemanticStates: expect.any(Function),
        }),
        operationContext: OPERATION_CONTEXT,
      }),
    );
  });

  it('rejects malformed prior checkout session refs restored on the materialized context', () => {
    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {},
        nextContext: createDocumentContext({
          versioning: {
            versionSurfaceStatusService: {
              readActiveCheckoutSession: () => ({
                checkedOutCommitId: BASE_COMMIT_ID,
                detached: false,
                branchName: SECRET_BRANCH,
              }),
            },
          },
        }),
      }),
    );

    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindPriorCheckoutRefError',
      identityFenceReason: 'priorCheckoutRefInvalid',
      providerIdentityClass: 'ref',
    });
    expectDiagnosticDetailsNotToLeak(error, [BASE_COMMIT_ID, SECRET_BRANCH]);
  });

  it('rejects stale prior checkout refs with redacted diagnostics', () => {
    const readRef = jest.fn(() => ({
      status: 'success',
      ref: {
        name: `refs/heads/${SECRET_BRANCH}`,
        commitId: MOVED_COMMIT_ID,
      },
    }));

    const error = captureError(() =>
      rebindVersioningAfterCheckout({
        versioning: {
          versionSurfaceStatusService: {
            readActiveCheckoutSession: () => ({
              checkedOutCommitId: BASE_COMMIT_ID,
              detached: false,
              branchName: SECRET_BRANCH,
              refHeadAtMaterialization: BASE_COMMIT_ID,
            }),
          },
          readService: { readRef },
        },
        nextContext: createDocumentContext(),
      }),
    );

    expect(readRef).toHaveBeenCalledWith(`refs/heads/${SECRET_BRANCH}`);
    expect(checkoutRebindIdentityDiagnosticDetails(error)).toEqual({
      cause: 'VersionCheckoutRebindPriorCheckoutRefError',
      identityFenceReason: 'priorCheckoutRefStale',
      providerIdentityClass: 'ref',
    });
    expectDiagnosticDetailsNotToLeak(error, [BASE_COMMIT_ID, MOVED_COMMIT_ID, SECRET_BRANCH]);
  });
});

function createDocumentContext(
  overrides: Record<string, unknown> = {},
): DocumentContext & { versioning?: unknown } {
  return {
    computeBridge: {
      encodeDiff: jest.fn(async () => new Uint8Array([0x01])),
      semanticWorkbookStateEnvelope: jest.fn(async () => ({
        schemaVersion: 1,
        state: { sheets: {} },
      })),
      diffSemanticWorkbookStates: jest.fn(async () => ({ changes: [] })),
    },
    ...overrides,
  } as unknown as DocumentContext & { versioning?: unknown };
}

function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected checkout rebind to throw.');
}

function expectDiagnosticDetailsNotToLeak(
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
