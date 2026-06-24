import type { VersionCommitOptions } from '@mog-sdk/contracts/api';

import type { VersionGraphRef, VersionGraphSymbolicRef } from './graph';
import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import { versionStoreDiagnostic, type VersionStoreDiagnostic } from './provider';
import { refVersionsEqual, type RefVersion } from './refs/ref-store';
import type {
  VersionMergeCommitCaptureSuccess,
  VersionNormalCommitCaptureFinalizeResult,
  WorkbookVersionCommitServiceMergeCommitInput,
} from './commit-service-types';

export function finalizeMergeCommitCapture(
  captured: VersionMergeCommitCaptureSuccess,
  result: VersionNormalCommitCaptureFinalizeResult,
): void {
  try {
    captured.finalize?.(result);
  } catch {
    // Commit success/failure is authoritative; capture finalization must not
    // mask the graph write result returned to the caller.
  }
}

export function expectedHeadForCommit(
  options: VersionCommitOptions,
  target: VersionGraphRef,
  head: VersionGraphSymbolicRef,
):
  | {
      readonly ok: true;
      readonly commitId: WorkbookCommitId;
      readonly revision: RefVersion;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    } {
  const expected = options.expectedHead;
  if (!expected) {
    return { ok: true, commitId: target.commitId, revision: target.revision };
  }

  if (options.targetRef !== undefined && expected.symbolicHeadRevision !== undefined) {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_INVALID_OPTIONS', {
          operation: 'commitGraphWrite',
          refName: target.name,
          commitId: target.commitId,
          safeMessage: 'symbolicHeadRevision is valid only for implicit HEAD commits.',
          recoverability: 'none',
          mutationGuarantee: 'no-write-attempted',
          details: { option: 'expectedHead.symbolicHeadRevision' },
        }),
      ],
    };
  }

  let expectedCommitId: WorkbookCommitId;
  try {
    expectedCommitId = parseWorkbookCommitId(expected.commitId, 'expectedHead.commitId');
  } catch {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_INVALID_COMMIT_ID', {
          operation: 'commitGraphWrite',
          refName: target.name,
          commitId: target.commitId,
          safeMessage: 'Expected version head commit id is invalid.',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    };
  }

  if (
    expectedCommitId !== target.commitId ||
    !isCounterRevision(expected.revision) ||
    !refVersionsEqual(target.revision, expected.revision)
  ) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(target.commitId, expectedCommitId, target.name, {
          expectedRevisionKind: expected.revision.kind,
          actualRevision: target.revision.value,
        }),
      ],
    };
  }

  if (
    expected.symbolicHeadRevision !== undefined &&
    (!isCounterRevision(expected.symbolicHeadRevision) ||
      !refVersionsEqual(head.revision, expected.symbolicHeadRevision))
  ) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(target.commitId, expectedCommitId, 'HEAD', {
          expectedRevisionKind: expected.symbolicHeadRevision.kind,
          actualRevision: head.revision.value,
        }),
      ],
    };
  }

  return { ok: true, commitId: expectedCommitId, revision: expected.revision };
}

export function expectedHeadForMergeCommit(
  input: WorkbookVersionCommitServiceMergeCommitInput,
  target: VersionGraphRef,
):
  | {
      readonly ok: true;
      readonly revision: RefVersion;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    } {
  let expectedCommitId: WorkbookCommitId;
  try {
    expectedCommitId = parseWorkbookCommitId(
      input.expectedTargetHead.commitId,
      'expectedTargetHead.commitId',
    );
  } catch {
    return {
      ok: false,
      diagnostics: [
        versionStoreDiagnostic('VERSION_INVALID_COMMIT_ID', {
          operation: 'commitGraphWrite',
          refName: target.name,
          commitId: target.commitId,
          safeMessage: 'Expected merge target head commit id is invalid.',
          recoverability: 'repair',
          mutationGuarantee: 'no-write-attempted',
        }),
      ],
    };
  }

  if (
    expectedCommitId !== input.ours ||
    expectedCommitId !== target.commitId ||
    !isCounterRevision(input.expectedTargetHead.revision) ||
    !refVersionsEqual(target.revision, input.expectedTargetHead.revision)
  ) {
    return {
      ok: false,
      diagnostics: [
        refConflictDiagnostic(target.commitId, input.ours, target.name, {
          expectedRevisionKind: input.expectedTargetHead.revision.kind,
          actualRevision: target.revision.value,
        }),
      ],
    };
  }

  return { ok: true, revision: input.expectedTargetHead.revision };
}

function refConflictDiagnostic(
  actualCommitId: WorkbookCommitId,
  expectedCommitId: WorkbookCommitId,
  refName: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_REF_CONFLICT', {
    operation: 'commitGraphWrite',
    refName,
    commitId: actualCommitId,
    safeMessage: 'Version graph head no longer matches the expected commit head.',
    recoverability: 'retry',
    mutationGuarantee: 'no-write-attempted',
    details: {
      expectedHead: expectedCommitId,
      actualHead: actualCommitId,
      ...details,
    },
  });
}

function isCounterRevision(value: unknown): value is RefVersion {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'counter' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}
