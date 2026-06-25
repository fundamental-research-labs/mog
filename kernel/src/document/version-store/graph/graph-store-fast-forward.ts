import { graphWriteSuccess, parseGraphCommitExpectedHead } from './graph-store-commit-helpers';
import {
  VERSION_GRAPH_MAIN_REF,
  graphRefNameFromRefName,
  missingGraphCommitExpectedRefVersionDiagnostic,
  parseGraphCommitTargetRef,
} from './graph-store-refs';
import { objectDigestFromWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import type { RefName } from '../refs/ref-name';
import type { InMemoryRefStore, LiveRefRecord, VersionDiagnostic } from '../refs/ref-store';
import { refVersionsEqual } from '../refs/ref-store';
import type {
  FastForwardVersionGraphInput,
  VersionGraphClosureReadResult,
  VersionGraphStoreDiagnostic,
  VersionGraphWriteFailure,
  VersionGraphWriteResult,
} from './graph-store-types';
import type { VersionGraphStoreOperation } from './graph-store-operation';

const MAIN_REF_NAME = 'main' as RefName;

type FastForwardGraph = {
  readonly refStore: InMemoryRefStore;
  readCommitClosure(commitId: WorkbookCommitId | string): Promise<VersionGraphClosureReadResult>;
};

export async function fastForwardGraphRef(
  graph: FastForwardGraph,
  input: FastForwardVersionGraphInput,
): Promise<VersionGraphWriteResult> {
  const target = parseGraphCommitTargetRef(input.targetRef, diagnostic);
  if (!target.ok) {
    return failedWrite(target.diagnostics, 'no-write-attempted');
  }

  const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
  if (expectedRefVersion === undefined) {
    return failedWrite(
      [missingGraphCommitExpectedRefVersionDiagnostic(target.name, diagnostic)],
      'no-write-attempted',
    );
  }

  const current = readRefRecord(graph.refStore, target.refName, 'fastForwardRef');
  if (!current.ok) {
    return failedWrite(current.diagnostics, 'no-write-attempted');
  }

  const main =
    target.refName === 'main'
      ? undefined
      : readRefRecord(graph.refStore, MAIN_REF_NAME, 'fastForwardRef');
  if (main !== undefined && !main.ok) {
    return failedWrite(main.diagnostics, 'no-write-attempted');
  }

  const expectedHead = parseGraphCommitExpectedHead(input.expectedHeadCommitId, diagnostic);
  if (!expectedHead.ok) {
    return failedWrite(expectedHead.diagnostics, 'no-write-attempted');
  }
  const nextHead = parseGraphCommitExpectedHead(input.nextCommitId, diagnostic);
  if (!nextHead.ok) {
    return failedWrite(nextHead.diagnostics, 'no-write-attempted');
  }

  if (
    current.ref.targetCommitId !== expectedHead.commitId ||
    !refVersionsEqual(current.ref.refVersion, expectedRefVersion)
  ) {
    return failedWrite(
      [refConflictDiagnostic(current.ref, expectedHead.commitId)],
      'no-write-attempted',
    );
  }

  const closure = await graph.readCommitClosure(nextHead.commitId);
  if (closure.status !== 'success') {
    return failedWrite(closure.diagnostics, 'no-write-attempted');
  }
  const nextCommit = closure.commits.find((commit) => commit.id === nextHead.commitId);
  if (!nextCommit) {
    return failedWrite(
      [
        diagnostic(
          'VERSION_MISSING_PARENT',
          'Fast-forward target commit is absent from its readable closure.',
          {
            operation: 'fastForwardRef',
            refName: graphRefNameFromRefName(current.ref.name),
            commitId: nextHead.commitId,
          },
        ),
      ],
      'no-write-attempted',
    );
  }
  if (!closure.commits.some((commit) => commit.id === current.ref.targetCommitId)) {
    return failedWrite(
      [
        diagnostic(
          'VERSION_UNSUPPORTED_PARENT_COMMIT',
          'Fast-forward target must descend from the current ref head.',
          {
            operation: 'fastForwardRef',
            refName: graphRefNameFromRefName(current.ref.name),
            commitId: nextHead.commitId,
            details: { expectedAncestor: current.ref.targetCommitId },
          },
        ),
      ],
      'no-write-attempted',
    );
  }

  const advanced = graph.refStore.advanceRefForGraphWrite({
    name: current.ref.name,
    nextCommitId: nextHead.commitId,
    expectedHead: current.ref.targetCommitId,
    expectedRefVersion: current.ref.refVersion,
    updatedBy: input.updatedBy,
  });
  if (!advanced.ok) {
    return failedWrite(
      [refConflictDiagnostic(current.ref, expectedHead.commitId, advanced.diagnostics)],
      'ref-not-mutated',
    );
  }

  return graphWriteSuccess(nextCommit, advanced.ref, main?.ref ?? advanced.ref);
}

function readRefRecord(
  refStore: InMemoryRefStore,
  refName: RefName,
  operation: VersionGraphStoreOperation,
):
  | { readonly ok: true; readonly ref: LiveRefRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionGraphStoreDiagnostic[] } {
  const result = refStore.getRef(refName);
  if (!result.ok) {
    return { ok: false, diagnostics: [refStoreDiagnostic(result.diagnostics, operation)] };
  }
  if (result.ref === null) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          refName === 'main' ? 'VERSION_GRAPH_UNINITIALIZED' : 'VERSION_INVALID_OPTIONS',
          refName === 'main'
            ? 'Graph main ref is not initialized.'
            : 'Graph branch ref was not found.',
          {
            refName: graphRefNameFromRefName(refName),
            operation,
            option: refName === 'main' ? undefined : 'ref',
            details: refName === 'main' ? undefined : { refMissing: true },
          },
        ),
      ],
    };
  }
  return { ok: true, ref: result.ref };
}

function refConflictDiagnostic(
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref no longer matches expected head.', {
    refName: graphRefNameFromRefName(currentRef.name),
    commitId: currentRef.targetCommitId,
    details: {
      expectedHead,
      actualHead: currentRef.targetCommitId,
      expectedDigest: objectDigestFromWorkbookCommitId(expectedHead).digest,
      actualDigest: objectDigestFromWorkbookCommitId(currentRef.targetCommitId).digest,
    },
    sourceDiagnostics,
  });
}

function refStoreDiagnostic(
  sourceDiagnostics: readonly VersionDiagnostic[],
  operation: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref store rejected the operation.', {
    refName: VERSION_GRAPH_MAIN_REF,
    operation,
    sourceDiagnostics,
  });
}

function failedWrite(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  mutationGuarantee: VersionGraphWriteFailure['mutationGuarantee'],
): VersionGraphWriteFailure {
  return { status: 'failed', diagnostics, mutationGuarantee };
}

function diagnostic(
  code: VersionGraphStoreDiagnostic['code'],
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity: 'error',
    message,
    ...options,
  };
}
