import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import {
  AUX_COMMIT_ID,
  SECRET_CAUSE,
  SECRET_ISSUE,
  SECRET_MESSAGE,
  SECRET_OPTION,
  SECRET_REF_NAME,
  expectNoDiagnosticLeak,
  expectNoWriteFailure,
  providerDeniedFailure,
  resetWorkbookProviderTestMocks,
  unsafeProviderFailure,
} from './version-refs-provider-w8-test-utils';

describe('WorkbookVersion provider-backed ref lifecycle W8 redaction and preflight', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it('rejects malformed delete ref names with redacted stable reasons before provider calls', async () => {
    const branchService = {
      readBranch: jest.fn(),
      deleteBranch: jest.fn(),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);
    const malformedRefName = 'Scenario/Provider-Secret';

    const malformed = await version.deleteRef({
      name: malformedRefName as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(malformed, 'VERSION_INVALID_OPTIONS', {
      payload: expect.objectContaining({
        issue: 'containsUppercase',
        refName: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(malformed, malformedRefName, 'Provider-Secret');
    expect(branchService.readBranch).not.toHaveBeenCalled();
    expect(branchService.deleteBranch).not.toHaveBeenCalled();
  });

  it.each([
    ['returned', async () => providerDeniedFailure()],
    [
      'thrown',
      async () => {
        throw providerDeniedFailure();
      },
    ],
  ])(
    'redacts %s provider delete denials with a stable reason',
    async (_label, deleteBranchImpl) => {
      const branchService = {
        readBranch: jest.fn(async () => ({
          ok: true,
          branch: {
            name: SECRET_REF_NAME,
            ref: {
              targetCommitId: AUX_COMMIT_ID,
              refVersion: { kind: 'counter', value: '0' },
            },
          },
          diagnostics: [],
        })),
        deleteBranch: jest.fn(deleteBranchImpl),
      };
      const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

      const denied = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(denied, 'VERSION_PERMISSION_DENIED', {
        recoverability: 'unsupported',
        payload: expect.objectContaining({
          conflict: 'redacted',
          issue: 'providerDenied',
        }),
      });
      expectNoDiagnosticLeak(denied, SECRET_REF_NAME, SECRET_CAUSE, SECRET_MESSAGE);
      expect(branchService.readBranch).toHaveBeenCalledTimes(1);
      expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
    },
  );

  it('redacts unknown provider diagnostic detail tokens for create and delete failures', async () => {
    const branchService = {
      createBranch: jest.fn(async () => unsafeProviderFailure('createBranch')),
      deleteBranch: jest.fn(async () => unsafeProviderFailure('deleteBranch')),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const createFailed = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(createFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      createFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );

    const deleteFailed = await version.deleteRef({
      name: SECRET_REF_NAME as any,
      expectedHead: AUX_COMMIT_ID as any,
      expectedRefRevision: { kind: 'counter', value: '0' },
    });
    expectNoWriteFailure(deleteFailed, 'VERSION_REF_WRITE_UNAVAILABLE', {
      payload: expect.objectContaining({
        conflict: 'redacted',
        issue: 'redacted',
        option: 'redacted',
      }),
    });
    expectNoDiagnosticLeak(
      deleteFailed,
      SECRET_REF_NAME,
      SECRET_ISSUE,
      SECRET_OPTION,
      SECRET_CAUSE,
      SECRET_MESSAGE,
    );
    expect(branchService.createBranch).toHaveBeenCalledTimes(1);
    expect(branchService.deleteBranch).toHaveBeenCalledTimes(1);
  });

  it('projects tombstone incarnation mismatches as redacted create CAS conflicts', async () => {
    const branchService = {
      createBranch: jest.fn(async () => ({
        ok: false,
        diagnostics: [
          {
            code: 'expectedPreviousRefIncarnationIdMismatch',
            severity: 'error',
            message: SECRET_MESSAGE,
            commitId: AUX_COMMIT_ID,
            tombstoneRefVersion: { kind: 'counter', value: '4' },
            previousRefIncarnationId: 'secret-previous-incarnation',
            details: { expectedPreviousRefIncarnationId: 'secret-expected-incarnation' },
          },
        ],
      })),
    };
    const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

    const conflict = await version.createBranch({
      name: SECRET_REF_NAME as any,
      targetCommitId: AUX_COMMIT_ID as any,
    });
    expectNoWriteFailure(conflict, 'VERSION_REF_CONFLICT', {
      recoverability: 'retry',
      payload: expect.objectContaining({
        actualHead: 'redacted',
        actualRefRevision: 'redacted',
        conflict: 'expectedPreviousRefIncarnationIdMismatch',
      }),
    });
    expectNoDiagnosticLeak(
      conflict,
      SECRET_REF_NAME,
      SECRET_MESSAGE,
      'secret-previous-incarnation',
      'secret-expected-incarnation',
    );
  });

  it.each([
    ['pending', { status: 'pending' }, 'activeCheckoutSessionPending'],
    [
      'failed',
      { status: 'failed', diagnostics: [unsafeProviderFailure('activeRef')] },
      'activeCheckoutSessionFailed',
    ],
  ])(
    'fails closed for %s active-ref provider reads before delete preflight',
    async (_label, active, _phase) => {
      const branchService = {
        readActiveCheckoutSession: jest.fn(async () => active),
        readBranch: jest.fn(),
        deleteBranch: jest.fn(),
      };
      const version = new WorkbookVersionImpl({ versioning: { branchService } } as any);

      const blocked = await version.deleteRef({
        name: SECRET_REF_NAME as any,
        expectedHead: AUX_COMMIT_ID as any,
        expectedRefRevision: { kind: 'counter', value: '0' },
      });
      expectNoWriteFailure(blocked, 'VERSION_PROVIDER_ERROR', {
        recoverability: 'retry',
        payload: expect.objectContaining({ phase: 'redacted' }),
      });
      expectNoDiagnosticLeak(blocked, SECRET_REF_NAME, SECRET_MESSAGE);
      expect(branchService.readBranch).not.toHaveBeenCalled();
      expect(branchService.deleteBranch).not.toHaveBeenCalled();
    },
  );
});
