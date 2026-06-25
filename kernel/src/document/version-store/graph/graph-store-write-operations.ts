import type { InMemoryWorkbookCommitStore } from '../commit-store';
import { graphWriteSuccess, parseGraphCommitExpectedHead } from './graph-store-commit-helpers';
import { diagnostic, mapCommitDiagnostics, refConflictDiagnostic } from './graph-store-diagnostics';
import { parseGraphCommitParentPlan, type GraphCommitParentPlan } from './graph-store-parent-plans';
import type { GraphStoreRefHelpers } from './graph-store-ref-helpers';
import { validateInputNamespaces } from './graph-store-record-validation';
import { failedGraphWrite } from './graph-store-results';
import {
  VERSION_GRAPH_MAIN_REF,
  missingGraphCommitExpectedRefVersionDiagnostic,
  parseGraphCommitTargetRef,
} from './graph-store-refs';
import type {
  CommitVersionGraphInput,
  InitializeVersionGraphInput,
  MergeVersionGraphInput,
  VersionGraphWriteResult,
} from './graph-store-types';
import type { VersionGraphNamespace } from '../object-store';
import type { InMemoryRefStore } from '../refs/ref-store';
import { refVersionsEqual } from '../refs/ref-store';

export type GraphStoreWriteContext = {
  readonly namespace: VersionGraphNamespace;
  readonly namespaceKey: string;
  readonly commitStore: InMemoryWorkbookCommitStore;
  readonly refStore: InMemoryRefStore;
  readonly refs: GraphStoreRefHelpers;
};

export async function initializeVersionGraph(
  context: GraphStoreWriteContext,
  input: InitializeVersionGraphInput,
): Promise<VersionGraphWriteResult> {
  const namespaceDiagnostics = validateInputNamespaces(context.namespaceKey, input);
  if (namespaceDiagnostics.length > 0) {
    return failedGraphWrite(namespaceDiagnostics, 'no-write-attempted');
  }

  const created = await context.commitStore.createWorkbookCommit({
    ...input,
    documentId: context.namespace.documentId,
    parentCommitIds: [],
  });
  if (created.status !== 'success') {
    return failedGraphWrite(mapCommitDiagnostics(created.diagnostics), 'no-write-attempted');
  }

  const initialized = context.refStore.initializeMain({
    targetCommitId: created.commit.id,
    createdBy: input.author,
    protected: true,
  });
  if (initialized.ok) {
    return graphWriteSuccess(created.commit, initialized.ref);
  }

  const existing = context.refStore.getRef('main');
  if (existing.ok && existing.ref?.targetCommitId === created.commit.id) {
    return graphWriteSuccess(created.commit, existing.ref);
  }

  return failedGraphWrite(
    [
      diagnostic('VERSION_GRAPH_CONFLICT', 'Graph main ref is already initialized.', {
        refName: VERSION_GRAPH_MAIN_REF,
        commitId: existing.ok && existing.ref ? existing.ref.targetCommitId : undefined,
        sourceDiagnostics: initialized.diagnostics,
      }),
    ],
    'ref-not-mutated',
  );
}

export async function commitVersionGraphWithParentPlan(
  context: GraphStoreWriteContext,
  input: CommitVersionGraphInput | MergeVersionGraphInput,
  parentPlan: GraphCommitParentPlan,
): Promise<VersionGraphWriteResult> {
  const namespaceDiagnostics = validateInputNamespaces(context.namespaceKey, input);
  if (namespaceDiagnostics.length > 0) {
    return failedGraphWrite(namespaceDiagnostics, 'no-write-attempted');
  }

  const target = parseGraphCommitTargetRef(input.targetRef, diagnostic);
  if (!target.ok) {
    return failedGraphWrite(target.diagnostics, 'no-write-attempted');
  }

  const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
  if (expectedRefVersion === undefined) {
    return failedGraphWrite(
      [missingGraphCommitExpectedRefVersionDiagnostic(target.name, diagnostic)],
      'no-write-attempted',
    );
  }

  const current =
    target.refName === 'main'
      ? context.refs.readMainRef('commit')
      : context.refs.readBranchRef(target.refName, 'commit');
  if (!current.ok) {
    return failedGraphWrite(current.diagnostics, 'no-write-attempted');
  }

  const main = target.refName === 'main' ? undefined : context.refs.readMainRef('commit');
  if (main !== undefined && !main.ok) {
    return failedGraphWrite(main.diagnostics, 'no-write-attempted');
  }

  const expectedHead = parseGraphCommitExpectedHead(input.expectedHeadCommitId, diagnostic);
  if (!expectedHead.ok) {
    return failedGraphWrite(expectedHead.diagnostics, 'no-write-attempted');
  }
  const parentResult = parseGraphCommitParentPlan(parentPlan, current.ref, {
    diagnostic,
    mapCommitDiagnostics,
    refConflictDiagnostic,
  });
  if (!parentResult.ok) {
    return failedGraphWrite(parentResult.diagnostics, 'no-write-attempted');
  }
  if (
    current.ref.targetCommitId !== expectedHead.commitId ||
    !refVersionsEqual(current.ref.refVersion, expectedRefVersion)
  ) {
    return failedGraphWrite(
      [refConflictDiagnostic(current.ref, expectedHead.commitId)],
      'no-write-attempted',
    );
  }

  const created = await context.commitStore.createWorkbookCommit({
    ...input,
    documentId: context.namespace.documentId,
    parentCommitIds: parentResult.parentCommitIds,
  });
  if (created.status !== 'success') {
    return failedGraphWrite(mapCommitDiagnostics(created.diagnostics), 'ref-not-mutated');
  }

  const advanced = context.refStore.advanceRefForGraphWrite({
    name: current.ref.name,
    nextCommitId: created.commit.id,
    expectedHead: current.ref.targetCommitId,
    expectedRefVersion: current.ref.refVersion,
    updatedBy: input.author,
  });
  if (!advanced.ok) {
    return failedGraphWrite(
      [refConflictDiagnostic(current.ref, expectedHead.commitId, advanced.diagnostics)],
      'ref-not-mutated',
    );
  }

  return graphWriteSuccess(created.commit, advanced.ref, main?.ref ?? advanced.ref);
}
